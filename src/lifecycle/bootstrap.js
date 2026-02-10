// File: src/lifecycle/bootstrap.js
import { env } from "../config/env.js";
import { validateEnvOrThrow } from "../config/validate.js";
import { ensureDirs } from "../config/constants.js";
import { logger } from "../logger/logger.js";

import { startHealthServer } from "../server/healthServer.js";

import { RestClient } from "../exchange/restClient.js";
import { WsManager } from "../exchange/wsManager.js";
import { UniverseService } from "../exchange/universeService.js";
import { KlinesService } from "../exchange/klinesService.js";

import { StateRepo } from "../storage/stateRepo.js";
import { PositionsRepo } from "../storage/positionsRepo.js";
import { RotationRepo } from "../storage/rotationRepo.js";
import { SignalsRepo } from "../storage/signalsRepo.js";
import { KlinesRepo } from "../storage/klinesRepo.js";
import { inc as incGroupStat } from "../storage/groupStatsRepo.js";

import { Ranker } from "../selection/ranker.js";
import { Pipeline } from "../selection/pipeline.js";
import { intervalToMs, normalizeInterval } from "../exchange/intervals.js";

import { startTelegram } from "../bot/telegram.js";
import { Sender } from "../bot/sender.js";
import { ProgressUi } from "../bot/progressUi.js";
import { Commands } from "../bot/commands.js";

import { startAutoScanJob } from "../jobs/autoScanJob.js";
import { startMonitorJob } from "../jobs/monitorJob.js";
import { startUniverseRefreshJob } from "../jobs/universeRefreshJob.js";
import { startKlinesPersistJob } from "../jobs/klinesPersistJob.js";
import { startRestSyncJob } from "../jobs/restSyncJob.js";

import { Monitor } from "../positions/monitor.js";
import { createPositionFromSignal } from "../positions/positionModel.js";
import { isWinOutcome, isDirectSL } from "../positions/outcomes.js";

import { entryCard } from "../bot/cards/entryCard.js";
import { tp1Card } from "../bot/cards/tp1Card.js";
import { tp2Card } from "../bot/cards/tp2Card.js";
import { tp3Card } from "../bot/cards/tp3Card.js";
import { slCard } from "../bot/cards/slCards.js";
import { recapCard } from "../bot/cards/recapCard.js";

import { buildOverlays } from "../charts/layout.js";
import { renderEntryChart } from "../charts/renderer.js";
import { getUtcDayString, utcDateKey } from "../utils/time.js";

export async function bootstrap() {
  validateEnvOrThrow();
  ensureDirs();

  const stateRepo = new StateRepo();
  const positionsRepo = new PositionsRepo();
  const rotationRepo = new RotationRepo({ cooldownMinutes: env.COOLDOWN_MINUTES });
  const signalsRepo = new SignalsRepo();
  const klinesRepo = new KlinesRepo();

  await Promise.all([stateRepo.load(), positionsRepo.load(), rotationRepo.load()]);

  const rest = new RestClient({
    baseUrl: env.BINANCE_FUTURES_REST,
    timeoutMs: env.REST_TIMEOUT_MS,
    retryMax: env.REST_RETRY_MAX,
    retryBaseMs: env.REST_RETRY_BASE_MS
  });

  const wsManager = new WsManager({
    wsBase: env.BINANCE_FUTURES_WS,
    maxStreamsPerSocket: env.WS_MAX_STREAMS_PER_SOCKET,
    backoffBaseMs: env.WS_BACKOFF_BASE_MS,
    backoffMaxMs: env.WS_BACKOFF_MAX_MS,
    logger
  });

  const universe = new UniverseService({
    rest,
    volumeMarket: env.VOLUME_MARKET,
    topN: env.TOP_VOLUME_N,

    // LOCKED wiring: ALL USDT-M perpetual with liquidity floor (+ AUTO volume gate)
    useTopVolume: env.USE_TOP_VOLUME,
    liquidityMinQuoteVol: env.LIQUIDITY_MIN_QUOTE_VOL_USDT,
    autoVolumeTopN: env.AUTO_VOLUME_TOP_N,
    autoMinQuoteVol: env.AUTO_MIN_QUOTE_VOL_USDT,

    logger
  });
  await universe.refresh();

  const thresholds = {
    ZONE_ATR_MULT: env.ZONE_ATR_MULT,
    SL_ATR_MULT: env.SL_ATR_MULT,
    ADX_MIN: env.ADX_MIN,
    ATR_PCT_MIN: env.ATR_PCT_MIN,
    RSI_BULL_MIN: env.RSI_BULL_MIN,
    RSI_BEAR_MAX: env.RSI_BEAR_MAX
  };

  const klines = new KlinesService({
    rest,
    wsManager,
    backfillLimit: 300,
    maxCandles: 800,
    klinesRepo,
    logger
  });

  klinesRepo.setProvider((symbol, tf) => klines.getCandles(symbol, tf));

  const allTfs = Array.from(new Set([...env.SCAN_TIMEFRAMES, env.SECONDARY_TIMEFRAME, "4h"]));
  let currentSymbols = new Set(Array.from(new Set([...universe.symbols(), "BTCUSDT"])));

  // preload cache from disk
  await klines.loadFromRepo(Array.from(currentSymbols), allTfs);

  // backfill (smart)
  await klines.backfill(Array.from(currentSymbols), allTfs);

  // subscribe WS (may be disabled -> REST-only mode)
  await klines.subscribe(Array.from(currentSymbols), allTfs);

  const ranker = new Ranker({ klines });
  const pipeline = new Pipeline({ universe, klines, ranker, thresholds, stateRepo, rotationRepo, env });

  const bot = startTelegram(env.TELEGRAM_BOT_TOKEN);
  const sender = new Sender({ bot, allowedGroupIds: env.ALLOWED_GROUP_IDS });
  const progressUi = new ProgressUi({ sender });

  const notifyChatIds = Array.from(
    new Set([env.TELEGRAM_CHAT_ID, env.TEST_SIGNALS_CHAT_ID, ...env.ALLOWED_GROUP_IDS].filter(Boolean).map(String))
  );

  const commands = new Commands({ bot, sender, progressUi, pipeline, stateRepo, positionsRepo, signalsRepo, env });
  commands.bind();

  const server = startHealthServer({
    port: env.PORT,
    getStatus: () => ({
      ok: true,
      ws: wsManager.status(),
      universe: universe.symbols().length,
      positions: positionsRepo.listActive().length
    })
  });

  const monitor = new Monitor({
    rest,
    positionsRepo,
    stateRepo,
    signalsRepo,
    sender,
    cards: { tp1Card, tp2Card, tp3Card, slCard }
  });

  const runAuto = async () => {
    const triggerTf = normalizeInterval(env.AUTO_TRIGGER_TF || "15m");
    const tfMs = intervalToMs(triggerTf);
    const nowMs = Date.now();
    const lastClosed = (Math.floor((nowMs - 1) / tfMs) * tfMs) + tfMs - 1;
    const lastAuto = stateRepo.lastAutoCandle(triggerTf);
    const deltaMs = lastClosed - lastAuto;

    logger.info("[AUTO_SCAN] tick start", { triggerTf, lastAuto, lastClosed, deltaMs });

    if (lastAuto >= lastClosed) {
      logger.info("[AUTO_SCAN] skip_no_new_candle", { triggerTf, lastAuto, lastClosed });
      return;
    }

    const todayAuto = stateRepo.getAutoTotalToday();
    const maxPerDay = env.MAX_SIGNALS_PER_DAY;
    const todayKey = utcDateKey();

    if (todayAuto >= maxPerDay) {
      stateRepo.markAutoCandle(triggerTf, lastClosed);
      await stateRepo.flush();
      logger.info("[AUTO_SCAN] run_end", {
        triggerTf,
        created: 0,
        sent: 0,
        reason: "max_signals_reached",
        alreadySentToday: todayAuto,
        maxPerDay
      });
      return;
    }

    logger.info("[AUTO_SCAN] run_start", {
      triggerTf,
      asOf: new Date(lastClosed).toISOString(),
      maxPerDay,
      alreadySentToday: todayAuto
    });

    const autoSymbols = (typeof universe.symbolsForAuto === "function"
      ? universe.symbolsForAuto()
      : (typeof universe.symbols === "function" ? universe.symbols() : [])) || [];

    const baseTfs = Array.isArray(env.AUTO_TIMEFRAMES) && env.AUTO_TIMEFRAMES.length
      ? env.AUTO_TIMEFRAMES
      : (Array.isArray(env.SCAN_TIMEFRAMES) ? env.SCAN_TIMEFRAMES : []);
    const autoTfs = [...baseTfs];
    if (env.SECONDARY_TIMEFRAME && !autoTfs.includes(env.SECONDARY_TIMEFRAME)) autoTfs.push(env.SECONDARY_TIMEFRAME);

    const universeCount = Array.isArray(autoSymbols) ? autoSymbols.length : 0;
    const topN = Math.max(0, Math.floor(Number(env.TOP10_PER_TF || 0)));
    const scanned = (topN > 0 && universeCount > 0) ? (Math.min(universeCount, topN) * autoTfs.length) : 0;

    const candidates = await pipeline.autoPickCandidates();

    const remaining = Math.max(0, maxPerDay - todayAuto);
    const limit = Math.min(env.SEND_TOP_N, remaining);

    const normTf = (x) => String(x || "").trim().toLowerCase();
    const swingTf = normTf(env.SECONDARY_TIMEFRAME || "4h");
    const playbookOf = (sig) => String(sig?.playbook || (normTf(sig?.tf) === swingTf ? "SWING" : "INTRADAY")).toUpperCase();
    const dirOf = (sig) => String(sig?.direction || "").toUpperCase();

    // LOCK: AUTO prefers top Swing + top Intraday (max 2), with guardrails.
    let bestSwing = null;
    let bestIntra = null;

    for (const sig of candidates) {
      const pb = playbookOf(sig);
      if (pb === "SWING" && !bestSwing) bestSwing = sig;
      if (pb === "INTRADAY" && !bestIntra) bestIntra = sig;
      if (bestSwing && bestIntra) break;
    }

    const preliminary = [];
    if (limit >= 1) {
      const primary = bestSwing || bestIntra;
      if (primary) preliminary.push(primary);
    }

    if (limit >= 2 && bestSwing && bestIntra) {
      const symSame = String(bestSwing.symbol) === String(bestIntra.symbol);
      const dirSame = dirOf(bestSwing) === dirOf(bestIntra) && dirOf(bestSwing) !== "";

      if (symSame && dirSame) {
        // Confluence: prefer Swing only + tag
        bestSwing.confluence = true;
        bestSwing.confluenceTfs = Array.from(new Set([bestIntra.tf, bestSwing.tf].filter(Boolean)));
      } else if (symSame && !dirSame) {
        // Opposite direction on same pair: find another intraday candidate (different symbol)
        let alt = null;
        for (const sig of candidates) {
          if (playbookOf(sig) !== "INTRADAY") continue;
          if (String(sig.symbol) === String(bestSwing.symbol)) continue;
          alt = sig;
          break;
        }
        if (alt) preliminary.push(alt);
      } else {
        // Different symbols: allow both
        if (preliminary.length === 1 && preliminary[0] === bestSwing) preliminary.push(bestIntra);
        else if (preliminary.length === 1 && preliminary[0] === bestIntra) preliminary.unshift(bestSwing);
      }
    }

    // LOCK: cooldown at least per pair+direction, ideally per playbook.
    const chosen = [];
    for (const sig of preliminary) {
      const pb = playbookOf(sig);
      const dir = dirOf(sig);
      if (!dir) continue;

      const okPlaybook = typeof stateRepo.canSendPairSidePlaybook === "function"
        ? stateRepo.canSendPairSidePlaybook(sig.symbol, dir, pb, env.COOLDOWN_MINUTES)
        : null;

      const ok = (okPlaybook !== null)
        ? okPlaybook
        : (typeof stateRepo.canSendPairSide === "function"
          ? stateRepo.canSendPairSide(sig.symbol, dir, env.COOLDOWN_MINUTES)
          : stateRepo.canSendSymbol(sig.symbol, env.COOLDOWN_MINUTES));

      if (!ok) continue;

      chosen.push(sig);

      if (typeof stateRepo.markSentPairSidePlaybook === "function") stateRepo.markSentPairSidePlaybook(sig.symbol, dir, pb);
      else if (typeof stateRepo.markSentPairSide === "function") stateRepo.markSentPairSide(sig.symbol, dir);
      else stateRepo.markSent(sig.symbol);
    }

    logger.info("[AUTO_SCAN] candidates", {
      triggerTf,
      universe: universeCount,
      scanned,
      passedGates: candidates.length,
      selected: chosen.length
    });

    if (!candidates.length) {
      stateRepo.markAutoCandle(triggerTf, lastClosed);
      await stateRepo.flush();
      logger.info("[AUTO_SCAN] run_end", { triggerTf, created: 0, sent: 0, reason: "no_candidates" });
      return;
    }

    if (!chosen.length) {
      stateRepo.markAutoCandle(triggerTf, lastClosed);
      await stateRepo.flush();
      logger.info("[AUTO_SCAN] run_end", { triggerTf, created: 0, sent: 0, reason: "no_selection" });
      return;
    }

    const utcDay = getUtcDayString();
    const normSymbol = (s) => String(s || "").toUpperCase();
    const normTfKey = (t) => String(t || "").toLowerCase();
    const normSide = (s) => String(s || "").toUpperCase();
    const buildSignalKey = (scopeId, sig) => (
      `AUTO:${String(scopeId)}:${normSymbol(sig?.symbol)}:${normTfKey(sig?.tf)}:${normSide(sig?.direction || sig?.side)}:${utcDay}`
    );

    let created = 0;
    let sent = 0;

    for (const sig of chosen) {
      const symbol = normSymbol(sig?.symbol);
      const tf = normTfKey(sig?.tf);
      const side = normSide(sig?.direction || sig?.side);

      const eligibleChatIds = [];
      const signalKeys = [];

      for (const scopeId of notifyChatIds) {
        const signalKey = buildSignalKey(scopeId, sig);
        const exists = await signalsRepo.hasSignalKey({ scopeId, utcDay, signalKey });
        if (exists) {
          logger.info("[AUTO_SCAN] skip_duplicate_signalKey", { signalKey, symbol, tf, side, utcDay, scopeId });
          continue;
        }
        eligibleChatIds.push(scopeId);
        signalKeys.push(signalKey);
      }

      if (!eligibleChatIds.length) continue;

      created += 1;
      const overlays = buildOverlays(sig);
      const png = await renderEntryChart(sig, overlays);

      const entryMessageIds = {};

      for (const chatId of eligibleChatIds) {
        await sender.sendPhoto(chatId, png);
        const msg = await sender.sendText(chatId, entryCard(sig));
        if (msg?.message_id) entryMessageIds[String(chatId)] = msg.message_id;
        if (msg) {
          sent += 1;
          try {
            await incGroupStat(chatId, todayKey, "autoSignalsSent", 1);
          } catch {}
        }
      }

      const pos = createPositionFromSignal(sig, {
        source: "AUTO",
        notifyChatIds: eligibleChatIds,
        telegram: Object.keys(entryMessageIds).length ? { entryMessageIds } : null
      });
      positionsRepo.upsert(pos);

      stateRepo.bumpAuto(sig.tf, sig.score, sig.macro.BTC_STATE);
      await signalsRepo.logEntry({
        source: "AUTO",
        signal: sig,
        meta: {
          publishedTo: eligibleChatIds,
          signalKey: signalKeys[0],
          signalKeys: signalKeys.length > 1 ? signalKeys : undefined
        }
      });
    }

    stateRepo.markAutoCandle(triggerTf, lastClosed);

    await Promise.all([positionsRepo.flush(), stateRepo.flush(), signalsRepo.flush()]);
    logger.info("[AUTO_SCAN] run_end", { triggerTf, created, sent, reason: "ok" });
  };


  const runMonitor = async () => {
    await monitor.tick(notifyChatIds);
  };

  const runRecap = async (yesterdayKey) => {
    if (!env.DAILY_RECAP) return;
    if (stateRepo.state.lastRecapSentForDay === yesterdayKey) return;

    const day = stateRepo.state.daily[yesterdayKey];
    if (!day) {
      stateRepo.setRecapSent(yesterdayKey);
      await stateRepo.flush();
      return;
    }

    const avgScore = day.scoreCount ? day.scoreSum / day.scoreCount : 0;
    const macroSummary = `BULLISH: ${day.macro.BULLISH} | BEARISH: ${day.macro.BEARISH} | NEUTRAL: ${day.macro.NEUTRAL}`;

    const tfb = day.tfBreakdown || {};
    const swingTf = String(env.SECONDARY_TIMEFRAME || "4h").toLowerCase();
    let intradayCount = 0;
    let swingCount = 0;
    for (const [k, v] of Object.entries(tfb)) {
      const tf = String(k || "").toLowerCase();
      const c = Number(v) || 0;
      if (!c) continue;
      if (tf === swingTf || tf === "4h") swingCount += c;
      else intradayCount += c;
    }
    const modeSummary = `INTRADAY: ${intradayCount} | SWING: ${swingCount}`;

    const resultsByPlaybook = { INTRADAY: { closed: 0, win: 0, directSl: 0 }, SWING: { closed: 0, win: 0, directSl: 0 } };
    try {
      const all = (typeof positionsRepo.listAll === "function") ? positionsRepo.listAll() : (positionsRepo.list?.() || []);
      const startMs = Date.parse(`${yesterdayKey}T00:00:00.000Z`);
      const endMs = startMs + 24 * 60 * 60 * 1000;
      for (const p of (Array.isArray(all) ? all : [])) {
        const closedAt = Number(p?.closedAt || 0);
        if (!closedAt || closedAt < startMs || closedAt >= endMs) continue;
        const pb = String(p?.playbook || (String(p?.tf || "").toLowerCase() === swingTf ? "SWING" : "INTRADAY")).toUpperCase();
        const bucket = resultsByPlaybook[pb] || (resultsByPlaybook[pb] = { closed: 0, win: 0, directSl: 0 });
        bucket.closed += 1;
        const win = isWinOutcome(p?.closeOutcome) || !!p?.hitTP1 || !!p?.hitTP2 || !!p?.hitTP3;
        if (win) bucket.win += 1;
        if (isDirectSL(p)) bucket.directSl += 1;
      }
    } catch {}

    const text = recapCard({
      dateKey: yesterdayKey,
      autoTotal: day.autoTotal,
      scanTotal: day.scanTotal,
      tfBreakdown: day.tfBreakdown,
      topScore: day.topScore,
      avgScore,
      win: day.win,
      lose: day.lose,
      macroSummary,
      modeSummary,
      resultsByPlaybook
    });

    for (const chatId of notifyChatIds) await sender.sendText(chatId, text);

    stateRepo.setRecapSent(yesterdayKey);
    await stateRepo.flush();
  };

  const runUniverseRefresh = async () => {
    await universe.refresh();

    const newSet = new Set(Array.from(new Set([...universe.symbols(), "BTCUSDT"])));
    const added = Array.from(newSet).filter((s) => !currentSymbols.has(s));
    currentSymbols = newSet;

    if (added.length) {
      await klines.loadFromRepo(added, allTfs);
      await klines.backfill(added, allTfs);
    }

    await klines.subscribe(Array.from(currentSymbols), allTfs);
    await Promise.all([stateRepo.flush(), rotationRepo.flush()]);
  };

  // persist klines cache periodically (dirty only)
  const klinesPersistJob = startKlinesPersistJob({
    intervalSec: 30,
    run: async () => {
      await klinesRepo.flushDirty({ maxKeys: 60 });
    }
  });

  // REST-only updater when WS is down / disabled
  let rr = 0;
  const restSyncJob = startRestSyncJob({
    intervalSec: 60,
    run: async () => {
      const st = wsManager.status();
      const now = Date.now();

      const wsDown =
        st.disabled ||
        st.openSockets === 0 ||
        (st.lastMessageAt && (now - st.lastMessageAt) > 120_000);

      if (!wsDown) return;

      const symbols = Array.from(currentSymbols);
      if (!symbols.length) return;

      const batchSize = 12;
      const batch = [];
      for (let i = 0; i < Math.min(batchSize, symbols.length); i++) {
        batch.push(symbols[(rr + i) % symbols.length]);
      }
      rr = (rr + batch.length) % symbols.length;

      logger.warn("rest_sync_ws_down", { openSockets: st.openSockets, disabled: st.disabled, batch: batch.length });

      // reuse smart backfill as lightweight sync
      await klines.backfill(batch, allTfs);
    }
  });

  const autoJob = startAutoScanJob({
    run: runAuto,
    onError: (err) => logger.error("[AUTO_SCAN] run_error", { err })
  });
  const monitorJob = startMonitorJob({ intervalSec: env.PRICE_MONITOR_INTERVAL_SEC, run: runMonitor });
  let recapJob = null;
  // Daily recap job is disabled (manual /info only).
  const universeJob = startUniverseRefreshJob({ hours: env.UNIVERSE_REFRESH_HOURS, run: runUniverseRefresh });

  logger.info("bootstrap_done");

  return {
    stop: async () => {
      try { autoJob.stop(); } catch {}
      try { monitorJob.stop(); } catch {}
      try { recapJob?.stop?.(); } catch {}
      try { universeJob.stop(); } catch {}
      try { klinesPersistJob.stop(); } catch {}
      try { restSyncJob.stop(); } catch {}
      try { await wsManager.stop(); } catch {}
      try { server.close(); } catch {}

      await Promise.all([
        stateRepo.flush(),
        positionsRepo.flush(),
        rotationRepo.flush(),
        signalsRepo.flush()
      ]);

      try { await klinesRepo.flushAll(); } catch {}
    }
  };
}
