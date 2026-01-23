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

import { Ranker } from "../selection/ranker.js";
import { Pipeline } from "../selection/pipeline.js";

import { startTelegram } from "../bot/telegram.js";
import { Sender } from "../bot/sender.js";
import { ProgressUi } from "../bot/progressUi.js";
import { Commands } from "../bot/commands.js";

import { startAutoScanJob } from "../jobs/autoScanJob.js";
import { startMonitorJob } from "../jobs/monitorJob.js";
import { startDailyRecapJob } from "../jobs/dailyRecapJob.js";
import { startUniverseRefreshJob } from "../jobs/universeRefreshJob.js";
import { startKlinesPersistJob } from "../jobs/klinesPersistJob.js";
import { startRestSyncJob } from "../jobs/restSyncJob.js";

import { Monitor } from "../positions/monitor.js";
import { createPositionFromSignal } from "../positions/positionModel.js";

import { entryCard } from "../bot/cards/entryCard.js";
import { tp1Card } from "../bot/cards/tp1Card.js";
import { tp2Card } from "../bot/cards/tp2Card.js";
import { tp3Card } from "../bot/cards/tp3Card.js";
import { slCard } from "../bot/cards/slCards.js";
import { recapCard } from "../bot/cards/recapCard.js";

import { buildOverlays } from "../charts/layout.js";
import { renderEntryChart } from "../charts/renderer.js";

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
    const todayAuto = stateRepo.getAutoTotalToday();
    if (todayAuto >= env.MAX_SIGNALS_PER_DAY) return;

    let advanced = false;
    for (const tf of [...env.SCAN_TIMEFRAMES, env.SECONDARY_TIMEFRAME]) {
      const clock = klines.lastClosedTime(tf);
      if (clock && clock > stateRepo.lastAutoCandle(tf)) advanced = true;
    }
    if (!advanced) return;

    const candidates = await pipeline.autoPickCandidates();
    if (!candidates.length) {
      for (const tf of [...env.SCAN_TIMEFRAMES, env.SECONDARY_TIMEFRAME]) {
        const clock = klines.lastClosedTime(tf);
        if (clock) stateRepo.markAutoCandle(tf, clock);
      }
      await stateRepo.flush();
      return;
    }

    const remaining = Math.max(0, env.MAX_SIGNALS_PER_DAY - todayAuto);
    const limit = Math.min(env.SEND_TOP_N, remaining);

    const chosen = [];
    for (const sig of candidates) {
      if (chosen.length >= limit) break;
      if (!stateRepo.canSendSymbol(sig.symbol, env.COOLDOWN_MINUTES)) continue;
      chosen.push(sig);
      stateRepo.markSent(sig.symbol);
    }

    for (const tf of [...env.SCAN_TIMEFRAMES, env.SECONDARY_TIMEFRAME]) {
      const clock = klines.lastClosedTime(tf);
      if (clock) stateRepo.markAutoCandle(tf, clock);
    }

    for (const sig of chosen) {
      const overlays = buildOverlays(sig);
      const png = await renderEntryChart(sig, overlays);

      const entryMessageIds = {};

      for (const chatId of notifyChatIds) {
        await sender.sendPhoto(chatId, png);
        const msg = await sender.sendText(chatId, entryCard(sig));
        if (msg?.message_id) entryMessageIds[String(chatId)] = msg.message_id;
      }

      const pos = createPositionFromSignal(sig, {
        source: "AUTO",
        notifyChatIds,
        telegram: Object.keys(entryMessageIds).length ? { entryMessageIds } : null
      });
      positionsRepo.upsert(pos);

      stateRepo.bumpAuto(sig.tf, sig.score, sig.macro.BTC_STATE);
      await signalsRepo.logEntry({ source: "AUTO", signal: sig, meta: { publishedTo: notifyChatIds } });
    }

    await Promise.all([positionsRepo.flush(), stateRepo.flush(), signalsRepo.flush()]);
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

    const text = recapCard({
      dateKey: yesterdayKey,
      autoTotal: day.autoTotal,
      scanTotal: day.scanTotal,
      tfBreakdown: day.tfBreakdown,
      topScore: day.topScore,
      avgScore,
      win: day.win,
      lose: day.lose,
      macroSummary
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

  const autoJob = startAutoScanJob({ run: runAuto });
  const monitorJob = startMonitorJob({ intervalSec: env.PRICE_MONITOR_INTERVAL_SEC, run: runMonitor });
  const recapJob = startDailyRecapJob({ hhmmUTC: env.DAILY_RECAP_UTC, run: runRecap });
  const universeJob = startUniverseRefreshJob({ hours: env.UNIVERSE_REFRESH_HOURS, run: runUniverseRefresh });

  logger.info("bootstrap_done");

  return {
    stop: async () => {
      try { autoJob.stop(); } catch {}
      try { monitorJob.stop(); } catch {}
      try { recapJob.stop(); } catch {}
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