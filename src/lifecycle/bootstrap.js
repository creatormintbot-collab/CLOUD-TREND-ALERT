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
import { SubscriptionsRepo } from "../storage/subscriptionsRepo.js";
import { UsersRepo } from "../storage/usersRepo.js";
import { QuotaRepo } from "../storage/quotaRepo.js";
import { DedupRepo } from "../storage/dedupRepo.js";
import { KlinesRepo } from "../storage/klinesRepo.js";
import { inc as incGroupStat } from "../storage/groupStatsRepo.js";

import { Ranker } from "../selection/ranker.js";
import { Pipeline } from "../selection/pipeline.js";

import { startTelegram, attachAutoLeaveHandlers } from "../bot/telegram.js";
import { Sender } from "../bot/sender.js";
import { ProgressUi } from "../bot/progressUi.js";
import { Commands } from "../bot/commands.js";
import { configureAccessPolicy } from "../bot/accessPolicy.js";

import { startAutoScanJob } from "../jobs/autoScanJob.js";
import { startMonitorJob } from "../jobs/monitorJob.js";
import { startUniverseRefreshJob } from "../jobs/universeRefreshJob.js";
import { startKlinesPersistJob } from "../jobs/klinesPersistJob.js";
import { startRestSyncJob } from "../jobs/restSyncJob.js";

import { Monitor } from "../positions/monitor.js";
import { createPositionFromSignal } from "../positions/positionModel.js";
import { isWinOutcome, isDirectSL } from "../positions/outcomes.js";

import { entryCard, entryHitCard } from "../bot/cards/entryCard.js";
import { tp1Card } from "../bot/cards/tp1Card.js";
import { tp2Card } from "../bot/cards/tp2Card.js";
import { tp3Card } from "../bot/cards/tp3Card.js";
import { slCard } from "../bot/cards/slCards.js";
import { recapCard } from "../bot/cards/recapCard.js";

import { buildOverlays } from "../charts/layout.js";
import { renderEntryChart } from "../charts/renderer.js";
import { utcDateKey } from "../utils/time.js";

export async function bootstrap() {
  validateEnvOrThrow();
  ensureDirs();

  const stateRepo = new StateRepo();
  const positionsRepo = new PositionsRepo();
  const rotationRepo = new RotationRepo({ cooldownMinutes: env.COOLDOWN_MINUTES });
  const signalsRepo = new SignalsRepo();
  const subscriptionsRepo = new SubscriptionsRepo();
  const usersRepo = new UsersRepo();
  const quotaRepo = new QuotaRepo();
  const dedupRepo = new DedupRepo();
  const klinesRepo = new KlinesRepo();

  await Promise.all([
    stateRepo.load(),
    positionsRepo.load(),
    rotationRepo.load(),
    subscriptionsRepo.load(),
    usersRepo.load(),
    quotaRepo.load(),
    dedupRepo.load()
  ]);

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
  const sender = new Sender({ bot, allowedGroupIds: env.ALLOWED_GROUP_IDS, allowedChannelIds: env.ALLOWED_CHANNEL_IDS, allowPrivate: true });
  configureAccessPolicy({ allowedGroups: env.ALLOWED_GROUP_IDS, allowedChannels: env.ALLOWED_CHANNEL_IDS });
  attachAutoLeaveHandlers(bot, { sender });
  const progressUi = new ProgressUi({ sender });

  const allowedGroupSet = new Set((env.ALLOWED_GROUP_IDS || []).map(String));
  const allowedChannelSet = new Set((env.ALLOWED_CHANNEL_IDS || []).map(String));
  const defaultGroupChatIds = Array.from(
    new Set(
      [env.TELEGRAM_CHAT_ID, env.TEST_SIGNALS_CHAT_ID]
        .filter(Boolean)
        .map(String)
        .filter((id) => allowedGroupSet.has(id) && !allowedChannelSet.has(id))
    )
  );

  const commands = new Commands({
    bot,
    sender,
    progressUi,
    pipeline,
    stateRepo,
    positionsRepo,
    signalsRepo,
    env,
    subscriptionsRepo,
    usersRepo,
    quotaRepo,
    dedupRepo
  });
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
    cards: { entryHitCard, tp1Card, tp2Card, tp3Card, slCard }
  });

  const dmSubCache = new Map();
  const DM_SUB_CACHE_MS = 6 * 60 * 60 * 1000;

  const runAuto = async () => {
    const todayKey = utcDateKey();
    try {

    let autoCreatedToday = 0;
    let scanCreatedToday = 0;
    let totalCreatedToday = 0;
    let countsSource = "signalsRepo";

    try {
      const counts = await signalsRepo.getEntryCountsBySource(todayKey);
      autoCreatedToday = Number(counts?.bySource?.AUTO || 0);
      scanCreatedToday = Number(counts?.bySource?.SCAN || 0);
      totalCreatedToday = Number(counts?.total || 0);
    } catch (err) {
      countsSource = "stateRepo";
      autoCreatedToday = Number(stateRepo.getAutoTotalToday?.() || 0);
      scanCreatedToday = 0;
      totalCreatedToday = autoCreatedToday;
      logger.warn("[AUTO_SCAN] quota_count_failed", { err });
    }

    if (!defaultGroupChatIds.length) {
      logger.warn("[AUTO_SCAN] skip_no_notify_chat", {
        reason: "sender_chat_not_configured",
        notifyChatIdsCount: defaultGroupChatIds.length
      });
      return;
    }

    if (autoCreatedToday >= env.MAX_SIGNALS_PER_DAY) {
      logger.info("[AUTO_SCAN] skip_quota", {
        autoCreatedToday,
        scanCreatedToday,
        totalCreatedToday,
        maxPerDay: env.MAX_SIGNALS_PER_DAY,
        countsSource
      });
      return;
    }

    let advanced = false;
    for (const tf of [...env.SCAN_TIMEFRAMES, env.SECONDARY_TIMEFRAME]) {
      const clock = klines.lastClosedTime(tf);
      if (clock && clock > stateRepo.lastAutoCandle(tf)) advanced = true;
    }
    if (!advanced) {
      logger.info("[AUTO_SCAN] skip_no_new_candle", {
        lastAutoCandle: stateRepo.state?.lastAutoCandle || {},
        countsSource
      });
      return;
    }

    const autoUniverse = typeof universe.symbolsForAuto === "function"
      ? universe.symbolsForAuto()
      : (universe.symbols?.() || []);
    if (!autoUniverse.length) {
      logger.info("[AUTO_SCAN] skip_universe_empty", {
        autoVolumeTopN: env.AUTO_VOLUME_TOP_N,
        autoMinQuoteVol: env.AUTO_MIN_QUOTE_VOL_USDT,
        totalUniverse: (universe.symbols?.() || []).length
      });
      for (const tf of [...env.SCAN_TIMEFRAMES, env.SECONDARY_TIMEFRAME]) {
        const clock = klines.lastClosedTime(tf);
        if (clock) stateRepo.markAutoCandle(tf, clock);
      }
      await stateRepo.flush();
      return;
    }

    const candidates = await pipeline.autoPickCandidates();
    if (!candidates.length) {
      const stats = pipeline.lastAutoStats || null;
      if (stats?.scoreTooLow) {
        logger.info("[AUTO_SCAN] skip_score_too_low", { minScore: env.AUTO_MIN_SCORE, stats });
      }
      logger.info("[AUTO_SCAN] skip_no_candidates", { stats, minScore: env.AUTO_MIN_SCORE });
      for (const tf of [...env.SCAN_TIMEFRAMES, env.SECONDARY_TIMEFRAME]) {
        const clock = klines.lastClosedTime(tf);
        if (clock) stateRepo.markAutoCandle(tf, clock);
      }
      await stateRepo.flush();
      return;
    }

    const remaining = Math.max(0, env.MAX_SIGNALS_PER_DAY - autoCreatedToday);
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

    if (!chosen.length && preliminary.length) {
      logger.info("[AUTO_SCAN] skip_cooldown_active", {
        preliminary: preliminary.length,
        candidates: candidates.length,
        cooldownMinutes: env.COOLDOWN_MINUTES
      });
    }

    for (const tf of [...env.SCAN_TIMEFRAMES, env.SECONDARY_TIMEFRAME]) {
      const clock = klines.lastClosedTime(tf);
      if (clock) stateRepo.markAutoCandle(tf, clock);
    }

    for (const sig of chosen) {
      const overlays = buildOverlays(sig);
      const png = await renderEntryChart(sig, overlays);

      const entryMessageIds = {};

      for (const chatId of defaultGroupChatIds) {
        await sender.sendPhoto(chatId, png);
        const msg = await sender.sendText(chatId, entryCard(sig));
        if (msg?.message_id) entryMessageIds[String(chatId)] = msg.message_id;
        if (msg) {
          try {
            await incGroupStat(chatId, todayKey, "autoSignalsSent", 1);
          } catch {}
        }
      }

      for (const groupChatId of defaultGroupChatIds) {
        const gid = String(groupChatId);
        const entryId = entryMessageIds[gid];
        const pos = createPositionFromSignal(sig, {
          source: "AUTO",
          notifyChatIds: [gid],
          telegram: entryId ? { entryMessageIds: { [gid]: entryId } } : null
        });
        pos.chatId = gid;
        pos.scopeId = `g:${gid}`;
        pos.id = `${pos.id}|${pos.scopeId}`;
        positionsRepo.upsert(pos);
      }

      stateRepo.bumpAuto(sig.tf, sig.score, sig.macro.BTC_STATE);
      await signalsRepo.logEntry({ source: "AUTO", signal: sig, meta: { publishedTo: defaultGroupChatIds } });
    }

    await Promise.all([positionsRepo.flush(), stateRepo.flush(), signalsRepo.flush()]);

    if (chosen.length) {
      logger.info("[AUTO_SCAN] sent", {
        count: chosen.length,
        autoCreatedToday,
        scanCreatedToday,
        totalCreatedToday,
        maxPerDay: env.MAX_SIGNALS_PER_DAY
      });
    }
    } finally {
      const normDir = (d) => {
        const x = String(d || "").toUpperCase();
        if (x.startsWith("LONG") || x === "L") return "LONG";
        if (x.startsWith("SHORT") || x === "S") return "SHORT";
        return x;
      };

      // CHANNEL broadcast AUTO (entry + lifecycle)
      try {
        if (env.CHANNEL_BROADCAST_ENABLED && Array.isArray(env.ALLOWED_CHANNEL_IDS) && env.ALLOWED_CHANNEL_IDS.length) {
          for (const channelIdRaw of env.ALLOWED_CHANNEL_IDS) {
            const channelId = String(channelIdRaw || "").trim();
            if (!channelId) continue;

            let picks = [];
            try {
              picks = await pipeline.pickAutoChannelHybrid({ intradayTfs: ["30m", "1h"], swingTf: "4h", limit: 2 });
            } catch {}

            for (const sig of (Array.isArray(picks) ? picks : [])) {
              const sym = String(sig?.symbol || "").toUpperCase();
              const tf = String(sig?.tf || "").toLowerCase();
              const dir = normDir(sig?.direction || sig?.side);
              const dkey = `${todayKey}|${channelId}|${sym}|${tf}|${dir}`;
              if (dedupRepo?.has?.(dkey)) continue;

              const overlays = buildOverlays(sig);
              const png = await renderEntryChart(sig, overlays);
              await sender.sendPhoto(channelId, png);
              const entryMsg = await sender.sendText(channelId, entryCard(sig));

              const pos = createPositionFromSignal(sig, {
                source: "AUTO",
                notifyChatIds: [String(channelId)],
                telegram: entryMsg?.message_id
                  ? { entryMessageIds: { [String(channelId)]: entryMsg.message_id } }
                  : null
              });
              pos.chatId = String(channelId);
              pos.scopeId = `c:${channelId}`;
              if (pos.scopeId && !String(pos.id || "").includes(`|${pos.scopeId}`)) {
                pos.id = `${pos.id}|${pos.scopeId}`;
              }
              pos.strategyKey = sig?.strategyKey || "PRO";
              pos.notifyChatIds = [String(channelId)];
              if (entryMsg?.message_id) {
                if (!pos.telegram || typeof pos.telegram !== "object") pos.telegram = {};
                if (!pos.telegram.entryMessageIds || typeof pos.telegram.entryMessageIds !== "object") {
                  pos.telegram.entryMessageIds = {};
                }
                pos.telegram.entryMessageIds[String(channelId)] = entryMsg.message_id;
              }
              positionsRepo.upsert(pos);

              await signalsRepo.logEntry({
                source: "AUTO",
                signal: sig,
                meta: { scopeId: `c:${channelId}`, targetType: "CHANNEL", strategyKey: sig?.strategyKey || "PRO", publishedTo: [String(channelId)] }
              });

              dedupRepo?.add?.(dkey);
            }
          }
          await Promise.all([signalsRepo.flush(), dedupRepo.flush(), positionsRepo.flush()]);
        }
      } catch (err) {
        logger.warn({ err }, "[AUTO_SCAN] channel_auto_failed");
      }

      // DM AUTO (entry + monitoring)
      try {
        const userIds = (typeof usersRepo?.listUserIds === "function") ? usersRepo.listUserIds() : [];
        const channelId = env.REQUIRED_SUBSCRIBE_CHANNEL_ID;

        const isSubscribed = async (userId) => {
          if (!channelId) return false;
          const key = String(userId || "");
          const now = Date.now();
          const cached = dmSubCache.get(key);
          if (cached && (now - cached.checkedAt) < DM_SUB_CACHE_MS) return cached.ok;

          let ok = false;
          try {
            const member = await bot.getChatMember(channelId, userId);
            const status = String(member?.status || "").toLowerCase();
            ok = status === "member" || status === "administrator" || status === "creator";
          } catch {}
          dmSubCache.set(key, { ok, checkedAt: now });
          return ok;
        };

        for (const uidRaw of userIds) {
          const uid = String(uidRaw || "").trim();
          const userId = Number(uid);
          if (!uid || !Number.isFinite(userId)) continue;

          const ok = await isSubscribed(userId);
          if (!ok) continue;

          const tier = String(subscriptionsRepo?.getTier?.(userId) || "FREE").toUpperCase();
          if (!quotaRepo?.canAuto?.(userId, tier)) continue;

          let picks = [];
          try {
            picks = await pipeline.pickAutoDm({ tier, intradayTfs: ["30m", "1h"], swingTf: "4h", limit: 2 });
          } catch {}

          for (const sig of (Array.isArray(picks) ? picks : [])) {
            if (!quotaRepo?.canAuto?.(userId, tier)) break;

            const sym = String(sig?.symbol || "").toUpperCase();
            const tf = String(sig?.tf || "").toLowerCase();
            const dir = normDir(sig?.direction || sig?.side);
            const dkey = `${todayKey}|${uid}|${sym}|${tf}|${dir}`;
            if (dedupRepo?.has?.(dkey)) continue;

            const overlays = buildOverlays(sig);
            const png = await renderEntryChart(sig, overlays);
            await sender.sendPhoto(uid, png);
            const entryMsg = await sender.sendText(uid, entryCard(sig));

            const pos = createPositionFromSignal(sig, {
              source: "AUTO",
              notifyChatIds: [String(uid)],
              telegram: entryMsg?.message_id
                ? { entryMessageIds: { [String(uid)]: entryMsg.message_id } }
                : null
            });

            pos.chatId = String(uid);
            pos.scopeId = `u:${uid}`;
            if (pos.scopeId && !String(pos.id || "").includes(`|${pos.scopeId}`)) {
              pos.id = `${pos.id}|${pos.scopeId}`;
            }
            pos.strategyKey = sig?.strategyKey || "PRO";
            if (Array.isArray(pos.notifyChatIds) && pos.notifyChatIds.length) {
              const merged = new Set(pos.notifyChatIds.map(String));
              merged.add(String(uid));
              pos.notifyChatIds = Array.from(merged);
            } else {
              pos.notifyChatIds = [String(uid)];
            }

            positionsRepo.upsert(pos);

            await signalsRepo.logEntry({
              source: "AUTO",
              signal: sig,
              meta: { scopeId: `u:${uid}`, targetType: "DM", tier, strategyKey: sig?.strategyKey || "PRO", publishedTo: [String(uid)] }
            });

            dedupRepo?.add?.(dkey);
            quotaRepo?.incAuto?.(userId);
          }
        }

        await Promise.all([positionsRepo.flush(), signalsRepo.flush(), quotaRepo.flush(), dedupRepo.flush()]);
      } catch (err) {
        logger.warn({ err }, "[AUTO_SCAN] dm_auto_failed");
      }
    }
  };


  const runMonitor = async () => {
    await monitor.tick();
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

    for (const chatId of defaultGroupChatIds) await sender.sendText(chatId, text);

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
        signalsRepo.flush(),
        subscriptionsRepo.flush(),
        usersRepo.flush(),
        quotaRepo.flush(),
        dedupRepo.flush()
      ]);

      try { await klinesRepo.flushAll(); } catch {}
    }
  };
}
