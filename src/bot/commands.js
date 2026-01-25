import { entryCard } from "./cards/entryCard.js";
import { recapCard } from "./cards/recapCard.js";
import { buildOverlays } from "../charts/layout.js";
import { renderEntryChart } from "../charts/renderer.js";
import { createPositionFromSignal } from "../positions/positionModel.js";
function utcDateKeyNow() {
  return new Date().toISOString().slice(0, 10);
}

function utcTimeNow() {
  return new Date().toISOString().slice(11, 16);
}

function startOfUtcDayMs(dateKey) {
  const dk = String(dateKey || utcDateKeyNow());
  return Date.parse(dk + "T00:00:00.000Z");
}

function sameUtcDay(ts, dateKey) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return false;
  return new Date(n).toISOString().slice(0, 10) === String(dateKey);
}

function compactNum(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0";
  const abs = Math.abs(x);
  if (abs >= 1e12) return (x / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (x / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (x / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (x / 1e3).toFixed(2) + "K";
  return String(Math.round(x));
}

function pickDayStats(state, dateKey) {
  if (!state || typeof state !== "object") return null;
  const dk = String(dateKey || utcDateKeyNow());

  const candidates = [
    state.dailyStats?.[dk],
    state.daily?.[dk],
    state.stats?.[dk],
    state.recap?.[dk],
    state.days?.[dk],
    state.byDay?.[dk]
  ];

  for (const c of candidates) {
    if (c && typeof c === "object") return c;
  }
  return null;
}

async function readStateSnapshot(stateRepo) {
  try {
    if (typeof stateRepo.getSnapshot === "function") return await stateRepo.getSnapshot();
    if (typeof stateRepo.getState === "function") return await stateRepo.getState();
    if (typeof stateRepo.get === "function") return await stateRepo.get();
    if (typeof stateRepo.read === "function") return await stateRepo.read();
    if (typeof stateRepo.load === "function") return await stateRepo.load();
    if (stateRepo.state && typeof stateRepo.state === "object") return stateRepo.state;
  } catch {}
  return null;
}

async function listAllPositions(positionsRepo) {
  try {
    if (typeof positionsRepo.listAll === "function") return await positionsRepo.listAll();
    if (typeof positionsRepo.list === "function") return await positionsRepo.list();
    if (typeof positionsRepo.getAll === "function") return await positionsRepo.getAll();
    if (typeof positionsRepo.items === "function") return await positionsRepo.items();
    if (Array.isArray(positionsRepo.positions)) return positionsRepo.positions;
    if (Array.isArray(positionsRepo.data)) return positionsRepo.data;
    if (Array.isArray(positionsRepo._data)) return positionsRepo._data;
  } catch {}
  return [];
}


async function readSignalsDayStats(signalsRepo, dayKey) {
  try {
    if (!signalsRepo) return null;
    const dk = String(dayKey || utcDateKeyNow());
    if (typeof signalsRepo.readDay !== "function") return null;

    const data = await signalsRepo.readDay(dk);
    const events = Array.isArray(data?.events) ? data.events : [];

    const stats = {
      autoSignalsSent: 0,
      scanRequestsSuccess: 0,
      scanSignalsSent: 0,
      totalSignalsCreated: 0,
      tfBreakdownCreated: { "15m": 0, "30m": 0, "1h": 0, "4h": 0 },
    };

    for (const ev of events) {
      if (!ev) continue;

      const type = String(ev.type || "").toUpperCase();

      if (type === "ENTRY") {
        const src = String(ev.source || "").toUpperCase();
        if (src === "AUTO") stats.autoSignalsSent++;
        if (src === "SCAN") {
          stats.scanSignalsSent++;
          // Each SCAN-produced ENTRY implies a successful /scan request.
          stats.scanRequestsSuccess++;
        }

        const tf = String(ev.tf || "").toLowerCase();
        if (stats.tfBreakdownCreated[tf] !== undefined) stats.tfBreakdownCreated[tf]++;

        stats.totalSignalsCreated++;
        continue;
      }

      // A /scan that returns "no signal" is still a successful request.
      if (type === "SCAN_NO_SIGNAL") {
        stats.scanRequestsSuccess++;
        continue;
      }

      // Duplicate-prevented / gated scan: still a successful request (not a failure).
      if (type === "SCAN_THROTTLED") {
        stats.scanRequestsSuccess++;
        continue;
      }

      // TIMEOUT / exception bucket => do NOT count as success.
    }

    return stats;
  } catch {
    return null;
  }
}

function isActivePos(p) {
  const s = String(p?.status || "").toUpperCase();
  if (!s) return true;
  if (s === "CLOSED" || s.startsWith("CLOSED")) return false;
  if (s === "EXPIRED") return false;
  return true;
}

function isClosedPos(p) {
  const s = String(p?.status || "").toUpperCase();
  return s === "CLOSED" || s.startsWith("CLOSED") || Number(p?.closedAt || 0) > 0;
}

function entryHitTs(p) {
  const a = Number(p?.entryHitAt || 0);
  const b = Number(p?.filledAt || 0);
  const c = Number(p?.entryFilledAt || 0);
  const d = Number(p?.entryAt || 0);
  return a || b || c || d || 0;
}

function slHit(p) {
  return Boolean(
    p?.hitSL ||
    p?.slHit ||
    p?.slHitAt ||
    String(p?.outcome || "").toUpperCase() === "SL" ||
    String(p?.closedReason || "").toUpperCase().includes("SL")
  );
}

function tpHitMax(p) {
  const t = Number(p?.tpHitMax);
  if (Number.isFinite(t)) return t;
  if (p?.hitTP3 || p?.tp3HitAt) return 3;
  if (p?.hitTP2 || p?.tp2HitAt) return 2;
  if (p?.hitTP1 || p?.tp1HitAt) return 1;
  return 0;
}

function formatTopCard({ dateKey, rows = [], isVolume = true }) {
  const header = [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "🏅 TOP VOLUME (CACHED)",
    `Date: ${dateKey} (UTC)`,
    ""
  ];

  const lines = rows.slice(0, 10).map((r, i) => {
    const rawVol =
      r?.quoteVolume ??
      r?.quoteVolumeUSDT ??
      r?.volumeUSDT ??
      r?.volumeUsd ??
      r?.usdtVolume ??
      r?.qv ??
      r?.volume;

    const volNum = Number(rawVol);
    const volText = Number.isFinite(volNum) ? compactNum(volNum) : "N/A";
    return `${i + 1}) ${r?.symbol || "N/A"} — ${volText}`;
  });

  return [...header, ...lines, "", "⚠ Not Financial Advice"].join("\n");
}

function formatStatusCard({
  dateKey,
  timeKey,
  autoSent = 0,
  autoCap = 0,
  scanOk = 0,
  scanSignalsSent = 0,
  totalCreated = 0,
  runningTotal = 0,
  entryHitRunning = 0,
  pendingEntry = 0,
  carriedRunning = 0,
  // Live breakdown by playbook (optional)
  intradayRunning = 0,
  intradayEntryHitRunning = 0,
  intradayPendingEntry = 0,
  intradayCarriedRunning = 0,
  intradayList = "",
  swingRunning = 0,
  swingEntryHitRunning = 0,
  swingPendingEntry = 0,
  swingCarriedRunning = 0,
  swingList = "",
  closedToday = 0,
  tp1Today = 0,
  tp2Today = 0,
  tp3Today = 0,
  directSlToday = 0,
  givebackToday = 0
}) {
  const winToday = tp1Today + tp2Today + tp3Today;
  const winrate = closedToday > 0 ? ((winToday / closedToday) * 100).toFixed(1) : "0.0";
  const directSlRate = closedToday > 0 ? ((directSlToday / closedToday) * 100).toFixed(1) : "0.0";

  return [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "🧭 STATUS (UTC)",
    `Date: ${dateKey} (UTC) | Now: ${timeKey} (UTC)`,
    "",
    "🤖 Activity Today (Created Today)",
    `• AUTO Signals Sent: ${autoSent}${autoCap ? ` / ${autoCap}` : ""}`,
    `• /scan Requests (success): ${scanOk}`,
    `• /scan Signals Sent: ${scanSignalsSent}`,
    `• Total Signals Created: ${totalCreated}`,
    "",
    "📌 Live Positions (Now)",
    `• Running Positions: ${runningTotal}`,
    `• Entry Hit & Running: ${entryHitRunning}`,
    `• Pending Entry: ${pendingEntry}`,
    `• Carried From Previous Days: ${carriedRunning}`,
    "",
    "🧩 Live Positions by Mode (Now)",
    `• Intraday: ${intradayRunning} running | ${intradayEntryHitRunning} entry-hit | ${intradayPendingEntry} pending | ${intradayCarriedRunning} carried`,
    `• Swing: ${swingRunning} running | ${swingEntryHitRunning} entry-hit | ${swingPendingEntry} pending | ${swingCarriedRunning} carried`,
    `• Intraday Active: ${intradayList || "-"}`,
    `• Swing Active: ${swingList || "-"}`,
    "",
    "🎯 Results (Closed Today)",
    `• Closed Trades: ${closedToday}`,
    `• TP3: ${tp3Today} | TP2: ${tp2Today} | TP1: ${tp1Today} | SL (direct): ${directSlToday}`,
    `• Giveback (SL after TP1/TP2): ${givebackToday}`,
    "",
    "📈 Rates (Closed Today)",
    `• Winrate (≥TP1): ${winrate}%`,
    `• Direct SL Rate: ${directSlRate}%`,
    "",
    "⚠ Not Financial Advice"
  ].join("\n");
}

function formatExplain({ symbol, diags, tfExplicit = null, rotationNote = false }) {
  const tfs = tfExplicit ? [tfExplicit] : (diags || []).map((d) => d.tf);

  const header = [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "🧠 SCAN EXPLAIN — RESULT",
    `🪙 Pair: ${symbol || "N/A"}`,
    `⏱ Checked: ${tfs.join(", ") || "N/A"}`,
    ""
  ];

  const lines = (diags || []).map((d) => {
    const score = Number(d.score || 0);
    const status = d.ok
      ? (d.blocked ? `BLOCKED (${d.blockReason})` : `OK (${score})`)
      : "NO SIGNAL";

    const issues = (d.issues || []).slice(0, 2).join(" ");
    return issues ? `${d.tf}: ${status} — ${issues}` : `${d.tf}: ${status}`;
  });

  const tips = [
    "",
    "Tips:",
    "• Wait for pullback closer to EMA21.",
    "• Prefer stronger ADX / higher ATR%.",
    "• If a timeframe is BLOCKED, it may be under gates (secondary, liquidity, or Ichimoku HTF)."
  ];

  const extra = rotationNote
    ? ["", "Note: /scan (no pair) checks one rotated pair at a time. Run /scan again to rotate."]
    : [];

  return [...header, ...lines, ...tips, ...extra].join("\n");
}

function ttlMsForTf(tf) {
  const t = String(tf || "").toLowerCase();
  if (t === "15m") return 6 * 60 * 60 * 1000;   // 6h
  if (t === "30m") return 12 * 60 * 60 * 1000;  // 12h
  if (t === "1h") return 24 * 60 * 60 * 1000;   // 24h
  if (t === "4h") return 24 * 60 * 60 * 1000;   // 24h
  return 24 * 60 * 60 * 1000;
}

function formatDuplicateNotice({ symbol, tf, pos }) {
  const status = pos?.status ? String(pos.status) : "ACTIVE";
  const createdAt = Number(pos?.createdAt ?? 0);
  const expiresAt = Number(pos?.expiresAt ?? 0);

  const now = Date.now();
  const minsLeft = (expiresAt && expiresAt > now) ? Math.max(0, Math.round((expiresAt - now) / 60000)) : null;

  const extra =
    minsLeft === null
      ? ""
      : `\n⏳ Expires In: ~${minsLeft} min`;

  return [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "⚠️ DUPLICATE PREVENTED",
    `🪙 Pair: ${symbol}`,
    `⏱ Timeframe: ${tf}`,
    `📌 Status: ${status}${extra}`,
    "",
    "Reason:",
    "• An existing signal is still active for this Pair + Timeframe.",
    "",
    "Tip:",
    "• Wait for it to fill/close, or scan a different pair/timeframe."
  ].join("\n");
}

export class Commands {
  constructor({ bot, sender, progressUi, pipeline, stateRepo, positionsRepo, signalsRepo, env }) {
    this.bot = bot;
    this.sender = sender;
    this.progressUi = progressUi;
    this.pipeline = pipeline;
    this.stateRepo = stateRepo;
    this.positionsRepo = positionsRepo;
    this.signalsRepo = signalsRepo;
    this.env = env;
  }

  bind() {
    this.bot.onText(/^\/help\b/i, async (msg) => {
      await this.sender.sendText(
        msg.chat.id,
        [
          "CLOUD TREND ALERT — Commands",
          "• /scan",
          "• /scan BTCUSDT",
          "• /scan BTCUSDT 15m",
          "• /scan BTCUSDT 30m",
          "• /scan BTCUSDT 1h",
          "• /scan BTCUSDT 4h",
          "• /top",
          "• /status",
          "• /info",
          "• /help"
        ].join("\n")
      );
    });

    this.bot.onText(/^\/top\b/i, async (msg) => {
      const dateKey = utcDateKeyNow();

      let rows = [];
      try {
        if (typeof this.pipeline.topVolumeCached === "function") rows = await this.pipeline.topVolumeCached();
        else if (typeof this.pipeline.topVolume === "function") rows = await this.pipeline.topVolume();
        else if (typeof this.pipeline.topRanked === "function") rows = await this.pipeline.topRanked();
      } catch {}

      const list = Array.isArray(rows) ? rows : [];
      await this.sender.sendText(msg.chat.id, formatTopCard({ dateKey, rows: list, isVolume: true }));
    });


    this.bot.onText(/^\/status\b/i, async (msg) => {
      const dateKey = utcDateKeyNow();
      const timeKey = utcTimeNow();

      const state = await readStateSnapshot(this.stateRepo);
      const day = pickDayStats(state, dateKey) || {};

      // Prefer signalsRepo (UTC) for activity numbers to avoid state drift.
      const sigStats = await readSignalsDayStats(this.signalsRepo, dateKey);

      const autoSent = sigStats
        ? Number(sigStats.autoSignalsSent || 0)
        : (Number(day.autoSignalsSent ?? day.autoSent ?? day.autoTotal ?? 0) || 0);

      const scanOk = sigStats
        ? Number(sigStats.scanRequestsSuccess || 0)
        : (Number(day.scanRequestsSuccess ?? day.scanRequestsOk ?? day.scanOk ?? 0) || 0);

      const scanSignalsSent = sigStats
        ? Number(sigStats.scanSignalsSent || 0)
        : (Number(day.scanSignalsSent ?? day.scanSent ?? 0) || 0);

      const totalCreated = sigStats
        ? Number(sigStats.totalSignalsCreated || (autoSent + scanSignalsSent))
        : (Number(day.totalSignalsCreated ?? day.totalSignalsSent ?? (autoSent + scanSignalsSent)) || 0);

      const autoCap = Number(this.env?.MAX_SIGNALS_PER_DAY ?? 0) || 0;

      const all = await listAllPositions(this.positionsRepo);
      const active = Array.isArray(this.positionsRepo.listActive?.()) ? this.positionsRepo.listActive() : all.filter(isActivePos);

      const startMs = startOfUtcDayMs(dateKey);
      const activeList = Array.isArray(active) ? active : [];

      const runningTotal = activeList.filter(isActivePos).length;
      const entryHitRunning = activeList.filter((p) => isActivePos(p) && entryHitTs(p) > 0).length;
      const pendingEntry = activeList.filter((p) => isActivePos(p) && entryHitTs(p) === 0).length;
      const carriedRunning = activeList.filter((p) => isActivePos(p) && Number(p?.createdAt || 0) > 0 && Number(p.createdAt) < startMs).length;

      // Live breakdown by playbook (INTRADAY vs SWING)
      const inferPlaybook = (p) => {
        const pb = String(p?.playbook || "").toUpperCase();
        if (pb === "INTRADAY" || pb === "SWING") return pb;
        const tf = String(p?.tf || "").toLowerCase();
        const sec = String(this.env?.SECONDARY_TIMEFRAME || "4h").toLowerCase();
        return tf === sec ? "SWING" : "INTRADAY";
      };

      const normalizeDir = (p) => {
        const raw =
          p?.direction ??
          p?.side ??
          p?.signal?.direction ??
          p?.signal?.side ??
          p?.bias ??
          "";
        const s = String(raw || "").toUpperCase();
        if (!s) return "";
        if (s.startsWith("LONG") || s === "L") return "LONG";
        if (s.startsWith("SHORT") || s === "S") return "SHORT";
        return s;
      };

      const formatPosShort = (p) => {
        const sym = String(p?.symbol || "").toUpperCase() || "N/A";
        const tf = String(p?.tf || "").toLowerCase() || "N/A";
        const dir = normalizeDir(p);
        const st = entryHitTs(p) > 0 ? "RUN" : "PEND";
        return dir ? `${sym} ${dir} (${tf}) ${st}` : `${sym} (${tf}) ${st}`;
      };

      const intradayPositions = activeList.filter((p) => inferPlaybook(p) === "INTRADAY");
      const swingPositions = activeList.filter((p) => inferPlaybook(p) === "SWING");

      const intradayRunning = intradayPositions.length;
      const swingRunning = swingPositions.length;

      const intradayEntryHitRunning = intradayPositions.filter((p) => entryHitTs(p) > 0).length;
      const swingEntryHitRunning = swingPositions.filter((p) => entryHitTs(p) > 0).length;

      const intradayPendingEntry = intradayPositions.filter((p) => entryHitTs(p) === 0).length;
      const swingPendingEntry = swingPositions.filter((p) => entryHitTs(p) === 0).length;

      const intradayCarriedRunning = intradayPositions.filter((p) => Number(p?.createdAt || 0) > 0 && Number(p.createdAt) < startMs).length;
      const swingCarriedRunning = swingPositions.filter((p) => Number(p?.createdAt || 0) > 0 && Number(p.createdAt) < startMs).length;

      const intradayList = intradayPositions.slice(0, 6).map(formatPosShort).join(", ");
      const swingList = swingPositions.slice(0, 6).map(formatPosShort).join(", ");

      const closedTodayList = (Array.isArray(all) ? all : [])
        .filter(isClosedPos)
        .filter((p) => sameUtcDay(Number(p?.closedAt || 0), dateKey));

      let tp1Today = 0;
      let tp2Today = 0;
      let tp3Today = 0;
      let directSlToday = 0;
      let givebackToday = 0;

      for (const p of closedTodayList) {
        const t = tpHitMax(p);
        const sl = slHit(p);
        if (t >= 3) tp3Today++;
        else if (t === 2) tp2Today++;
        else if (t === 1) tp1Today++;
        else if (sl) directSlToday++;
        if (sl && t >= 1) givebackToday++;
      }

      const closedToday = closedTodayList.length;

      await this.sender.sendText(
        msg.chat.id,
        formatStatusCard({
          dateKey,
          timeKey,
          autoSent,
          autoCap,
          scanOk,
          scanSignalsSent,
          totalCreated,
          runningTotal,
          entryHitRunning,
          pendingEntry,
          carriedRunning,
          intradayRunning,
          intradayEntryHitRunning,
          intradayPendingEntry,
          intradayCarriedRunning,
          intradayList,
          swingRunning,
          swingEntryHitRunning,
          swingPendingEntry,
          swingCarriedRunning,
          swingList,
          closedToday,
          tp1Today,
          tp2Today,
          tp3Today,
          directSlToday,
          givebackToday
        })
      );
    });

    this.bot.onText(/^\/info\b/i, async (msg) => {
      const dateKey = utcDateKeyNow();

      const state = await readStateSnapshot(this.stateRepo);
      const day = pickDayStats(state, dateKey) || {};

      // Prefer signalsRepo (UTC) for activity numbers to avoid state drift.
      const sigStats = await readSignalsDayStats(this.signalsRepo, dateKey);

      const autoSent = sigStats
        ? Number(sigStats.autoSignalsSent || 0)
        : (Number(day.autoSignalsSent ?? day.autoSent ?? day.autoTotal ?? 0) || 0);

      const scanReqSuccess = sigStats
        ? Number(sigStats.scanRequestsSuccess || 0)
        : (Number(day.scanRequestsSuccess ?? day.scanRequestsOk ?? day.scanOk ?? day.scanRequests ?? day.scanTotal ?? 0) || 0);

      const scanSignalsSent = sigStats
        ? Number(sigStats.scanSignalsSent || 0)
        : (Number(day.scanSignalsSent ?? day.scanSent ?? 0) || 0);

      const totalCreated = sigStats
        ? Number(sigStats.totalSignalsCreated || (autoSent + scanSignalsSent))
        : (Number(day.totalSignalsCreated ?? day.totalSignalsSent ?? (autoSent + scanSignalsSent)) || 0);

      const tfBreakdownSent =
        (sigStats && sigStats.tfBreakdownCreated) ||
        day.tfBreakdownCreated ||
        day.tfBreakdownSent ||
        day.tfBreakdownSignals ||
        day.tfBreakdown ||
        null;

      const all = await listAllPositions(this.positionsRepo);
      const active = Array.isArray(this.positionsRepo.listActive?.()) ? this.positionsRepo.listActive() : all.filter(isActivePos);
      const startMs = startOfUtcDayMs(dateKey);

      const activeList = Array.isArray(active) ? active : [];
      const pendingEntry = activeList.filter((p) => isActivePos(p) && entryHitTs(p) === 0).length;
      const filledOpen = activeList.filter((p) => isActivePos(p) && entryHitTs(p) > 0).length;
      const carriedOpen = activeList.filter((p) => isActivePos(p) && Number(p?.createdAt || 0) > 0 && Number(p.createdAt) < startMs).length;

      const entryHitsToday = (Array.isArray(all) ? all : [])
        .filter((p) => entryHitTs(p) > 0 && sameUtcDay(entryHitTs(p), dateKey))
        .length;

      const expiredToday = (Array.isArray(all) ? all : [])
        .filter((p) => String(p?.status || "").toUpperCase() === "EXPIRED")
        .filter((p) => sameUtcDay(Number(p?.expiredAt || p?.closedAt || p?.expiresAt || 0), dateKey))
        .length;

      const closedTodayList = (Array.isArray(all) ? all : [])
        .filter(isClosedPos)
        .filter((p) => sameUtcDay(Number(p?.closedAt || 0), dateKey));

      let tp1Today = 0;
      let tp2Today = 0;
      let tp3Today = 0;
      let directSlToday = 0;
      let givebackToday = 0;

      for (const p of closedTodayList) {
        const t = tpHitMax(p);
        const sl = slHit(p);
        if (t >= 3) tp3Today++;
        else if (t === 2) tp2Today++;
        else if (t === 1) tp1Today++;
        else if (sl) directSlToday++;
        if (sl && t >= 1) givebackToday++;
      }

      const closedTrades = closedTodayList.length;
      const win = tp1Today + tp2Today + tp3Today;

      // Cohort (Created Today) — progress
      const cohort = (Array.isArray(all) ? all : []).filter((p) => sameUtcDay(Number(p?.createdAt || 0), dateKey));
      const cohortCreated = cohort.length;
      const cohortClosedSoFar = cohort.filter(isClosedPos).length;
      const cohortStillOpen = Math.max(0, cohortCreated - cohortClosedSoFar);

      let cTp1 = 0;
      let cTp2 = 0;
      let cTp3 = 0;
      let cDirectSl = 0;
      let cGiveback = 0;

      for (const p of cohort.filter(isClosedPos)) {
        const t = tpHitMax(p);
        const sl = slHit(p);
        if (t >= 3) cTp3++;
        else if (t === 2) cTp2++;
        else if (t === 1) cTp1++;
        else if (sl) cDirectSl++;
        if (sl && t >= 1) cGiveback++;
      }

      const cohortWins = cTp1 + cTp2 + cTp3;
      const cohortWinrate = cohortClosedSoFar > 0 ? ((cohortWins / cohortClosedSoFar) * 100).toFixed(1) : "0.0";

      const payload = {
        dateKey,
        autoSignalsSent: autoSent,
        scanRequestsSuccess: scanReqSuccess,
        scanSignalsSent,
        totalSignalsCreated: totalCreated,
        tfBreakdownCreated: tfBreakdownSent,
        topScore: day.topScore,
        avgScore: day.avgScore,

        pendingEntry,
        filledOpen,
        expiredToday,
        entryHitsToday,
        carriedOpen,

        closedTrades,
        win,
        tp1: tp1Today,
        tp2: tp2Today,
        tp3: tp3Today,
        directSl: directSlToday,
        giveback: givebackToday,

        cohortCreated,
        cohortClosedSoFar,
        cohortStillOpen,
        cohortWins,
        cohortTp1: cTp1,
        cohortTp2: cTp2,
        cohortTp3: cTp3,
        cohortDirectSl: cDirectSl,
        cohortGiveback: cGiveback,
        cohortWinrate,

        macroCounts: day.macroCounts,
        macroSummary: day.macroSummary
      };

      await this.sender.sendText(msg.chat.id, recapCard(payload));
    });
    this.bot.onText(/^\/scan\b(.*)$/i, async (msg, match) => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id ?? 0;

      const raw = (match?.[1] || "").trim();
      const args = raw ? raw.split(/\s+/).filter(Boolean) : [];
      const symbolArg = args[0]?.toUpperCase();
      const tfArg = args[1]?.toLowerCase();
      const activeSymbols = (() => {
        try {
          const list = Array.isArray(this.positionsRepo.listActive?.()) ? this.positionsRepo.listActive() : [];
          const syms = list
            .filter((p) => p && p.status !== "CLOSED" && p.status !== "EXPIRED")
            .map((p) => String(p.symbol || "").toUpperCase())
            .filter(Boolean);
          return Array.from(new Set(syms));
        } catch {
          return [];
        }
      })();

      // Validate timeframe (avoid wasted work / silent failures)
      const allowedTfs = (() => {
        const rawScan = this.env?.SCAN_TIMEFRAMES;
        const list = Array.isArray(rawScan)
          ? rawScan
          : String(rawScan || "").split(",").map((x) => x.trim()).filter(Boolean);

        const sec = String(this.env?.SECONDARY_TIMEFRAME || "").trim();
        if (sec && !list.includes(sec)) list.push(sec);

        // normalize
        return list.map((x) => String(x).toLowerCase());
      })();

      if (tfArg && !allowedTfs.includes(tfArg)) {
        await this.sender.sendText(chatId, [
          "CLOUD TREND ALERT",
          "━━━━━━━━━━━━━━━━━━",
          "⚠️ INVALID TIMEFRAME",
          `Provided: ${tfArg}`,
          `Allowed: ${allowedTfs.join(", ") || "N/A"}`,
          "",
          "Usage:",
          "• /scan BTCUSDT",
          "• /scan BTCUSDT 15m",
          "• /scan BTCUSDT 1h",
          `• /scan BTCUSDT ${String(this.env?.SECONDARY_TIMEFRAME || "4h")}`
        ].join("\n"));
        return;
      }

      // Count every /scan request (UTC day), regardless of outcome.
      try {
        if (typeof this.stateRepo.bumpScanRequest === "function") {
          this.stateRepo.bumpScanRequest();
          await this.stateRepo.flush();
        }
      } catch {}


      let symbolUsed = symbolArg || null;
      const rotationMode = !symbolArg;

      const startedAt = Date.now();
      let out = null;
      let secondaryPick = null;


      // Rotation mode keeps Progress UI (single edited message).
      if (rotationMode) {
        out = await this.progressUi.run({ chatId, userId }, async () => {
          const dual = await this.pipeline.scanBestDual({ excludeSymbols: activeSymbols });
          const primary = dual?.primary || null;
          secondaryPick = dual?.secondary || null;
          symbolUsed = primary?.symbol || null;
          return primary;
        });
      } else {
        // Targeted /scan (pair / pair+tf) skips Progress UI to avoid double messages
        // and focuses on a single explain/result response.
        try {
          let res = null;

          if (symbolArg && !tfArg) {
            symbolUsed = symbolArg;

            // LOCKED: /scan (pair only) returns best INTRADAY + SWING (4h), max 2 cards.
            const dual = await this.pipeline.scanPairDual(symbolArg);
            res = dual?.primary || null;
            secondaryPick = dual?.secondary || null;
          } else {
            symbolUsed = symbolArg;
            res = await this.pipeline.scanPairTf(symbolArg, tfArg);

            // LOCKED 4h special rule:
            if (tfArg === this.env.SECONDARY_TIMEFRAME && symbolArg !== "ETHUSDT") {
              if (!res) res = null;
              else if ((res.score || 0) < this.env.SECONDARY_MIN_SCORE) res = null;
            }
          }

          const elapsedMs = Date.now() - startedAt;
          out = res ? { kind: "OK", result: res, elapsedMs } : { kind: "NO_SIGNAL", elapsedMs };
        } catch (e) {
          out = { kind: "ERROR", elapsedMs: Date.now() - startedAt, error: e };
        }
      }

      if (out.kind === "THROTTLED") {
        await this.signalsRepo.logScanThrottled({
          chatId,
          query: { symbol: symbolUsed || null, tf: tfArg || null, raw: raw || "" }
        });
        return;
      }

      if (out.kind === "LOCKED") return;

      if (out.kind === "NO_SIGNAL") {
        await this.signalsRepo.logScanNoSignal({
          chatId,
          query: { symbol: symbolUsed || null, tf: tfArg || null, raw: raw || "" },
          elapsedMs: out.elapsedMs
        });

        // explain (best-effort)
        try {
          if (symbolUsed) {
            if (symbolArg && tfArg) {
              const d = this.pipeline.explainPairTf(symbolUsed, tfArg);
              await this.sender.sendText(chatId, formatExplain({
                symbol: symbolUsed,
                diags: [d],
                tfExplicit: tfArg,
                rotationNote: false
              }));
            } else {
              const diags = this.pipeline.explainPair(symbolUsed);
              await this.sender.sendText(chatId, formatExplain({
                symbol: symbolUsed,
                diags,
                tfExplicit: null,
                rotationNote: false
              }));
            }
          }
        } catch {}

        return;
      }

      if (out.kind === "TIMEOUT") {
        await this.signalsRepo.logScanTimeout({
          chatId,
          query: { symbol: symbolUsed || null, tf: tfArg || null, raw: raw || "" },
          elapsedMs: out.elapsedMs
        });

        // If Progress UI bubble exists, it already shows a timeout message (avoid duplicate spam).
        if (!out.messageId) {
          await this.sender.sendText(chatId, [
            "CLOUD TREND ALERT",
            "⚠️ Scan timed out. Try again later."
          ].join("\n"));
        }
        return;
      }

      if (out.kind === "ERROR") {
        const errMsg =
          (out.error && (out.error.message || out.error.stack || String(out.error))) ||
          "UNKNOWN_ERROR";

        // Log as timeout bucket with explicit meta (keeps repo API unchanged).
        try {
          await this.signalsRepo.logScanTimeout({
            chatId,
            query: { symbol: symbolUsed || null, tf: tfArg || null, raw: raw || "" },
            elapsedMs: out.elapsedMs,
            meta: { reason: "EXCEPTION", err: errMsg.slice(0, 500) }
          });
        } catch {}

        await this.sender.sendText(chatId, [
          "CLOUD TREND ALERT",
          "━━━━━━━━━━━━━━━━━━",
          "⚠️ Scan failed. Try again later.",
          "",
          "Note:",
          "• If this keeps happening, check VPS logs for the underlying error."
        ].join("\n"));
        return;
      }

      if (out.kind !== "OK") return;

      let res = out.result;
      if (!res || !res.ok || res.score < 70 || res.scoreLabel === "NO SIGNAL") {
        await this.signalsRepo.logScanNoSignal({
          chatId,
          query: { symbol: symbolUsed || null, tf: tfArg || null, raw: raw || "" },
          elapsedMs: out.elapsedMs,
          meta: { reason: "SCORE_LT_70_OR_INVALID" }
        });

        try {
          if (symbolUsed) {
            const diags = this.pipeline.explainPair(symbolUsed);
            await this.sender.sendText(chatId, formatExplain({
              symbol: symbolUsed,
              diags,
              tfExplicit: null,
              rotationNote: false
            }));
          }
        } catch {}

        return;
      }


      // LOCK: normalize playbook + guardrails for dual picks (Intraday vs Swing)
      const secTf = String(this.env?.SECONDARY_TIMEFRAME || "4h").toLowerCase();
      const inferPlaybook = (sig) => {
        const tf = String(sig?.tf || "").toLowerCase();
        return tf === secTf ? "SWING" : "INTRADAY";
      };
      const normSym = (s) => String(s || "").toUpperCase();
      const normDir = (d) => {
        const x = String(d || "").toUpperCase();
        if (!x) return "";
        if (x.startsWith("LONG") || x === "L") return "LONG";
        if (x.startsWith("SHORT") || x === "S") return "SHORT";
        return x;
      };
      const scanLog = (evt, obj) => {
        try {
          console.info("[SCAN]", evt, JSON.stringify(obj || {}));
        } catch {
          console.info("[SCAN]", evt);
        }
      };

      const ensurePlaybook = (sig) => {
        try {
          if (sig && typeof sig === "object" && !sig.playbook) sig.playbook = inferPlaybook(sig);
        } catch {}
      };

      const applyGuardrails = () => {
        let onlyOne = false;
        try {
          if (secondaryPick && secondaryPick.ok) {
            const pSym0 = normSym(res?.symbol);
            const sSym0 = normSym(secondaryPick?.symbol);
            const pDir0 = normDir(res?.direction);
            const sDir0 = normDir(secondaryPick?.direction);

            const pPb0 = String(res?.playbook || inferPlaybook(res)).toUpperCase();
            const sPb0 = String(secondaryPick?.playbook || inferPlaybook(secondaryPick)).toUpperCase();

            scanLog("candidates", {
              primary: { symbol: pSym0, tf: String(res?.tf || ""), dir: pDir0, playbook: pPb0, score: Math.round(res?.score || 0) },
              secondary: { symbol: sSym0, tf: String(secondaryPick?.tf || ""), dir: sDir0, playbook: sPb0, score: Math.round(secondaryPick?.score || 0) }
            });

            if (pSym0 && sSym0 && pSym0 === sSym0) {
              onlyOne = true; // same pair => max 1 card (LOCK)
              const isSwingP = pPb0 === "SWING";
              const isSwingS = sPb0 === "SWING";

              // Prefer Swing (LOCK). Keep the other as fallback if Swing is duplicate.
              if (!isSwingP && isSwingS) {
                const tmp = res;
                res = secondaryPick;
                secondaryPick = tmp;
              }

              const pSym = normSym(res?.symbol);
              const sSym = normSym(secondaryPick?.symbol);
              const pDir = normDir(res?.direction);
              const sDir = normDir(secondaryPick?.direction);

              const intraTf = String(secondaryPick?.tf || "");
              const swingTf = String(res?.tf || "");

              if (pSym && sSym && pSym === sSym && pDir && sDir && pDir === sDir) {
                // Confluence: same pair + same direction across playbooks
                res.confluence = "INTRADAY + SWING";
                res.confluenceTfs = [intraTf, swingTf].filter(Boolean);
                secondaryPick.confluence = "INTRADAY + SWING";
                secondaryPick.confluenceTfs = [intraTf, swingTf].filter(Boolean);

                scanLog("guardrail_confluence", { symbol: pSym, direction: pDir, prefer: "SWING" });
              } else {
                // Same pair but opposite direction => never send two directions (LOCK).
                scanLog("guardrail_same_pair_opposite_dir", { symbol: pSym, primaryDir: pDir, secondaryDir: sDir, prefer: "SWING" });
              }
            }
          } else if (res) {
            scanLog("candidates", {
              primary: { symbol: normSym(res?.symbol), tf: String(res?.tf || ""), dir: normDir(res?.direction), playbook: String(res?.playbook || inferPlaybook(res)).toUpperCase(), score: Math.round(res?.score || 0) }
            });
          }
        } catch {}
        return onlyOne;
      };

      const findActiveDup = (sig) => {
        if (!sig) return null;
        try {
          return (typeof this.positionsRepo.findActiveBySymbolTf === "function"
            ? this.positionsRepo.findActiveBySymbolTf(sig.symbol, sig.tf)
            : null) ||
            (Array.isArray(this.positionsRepo.listActive?.())
              ? this.positionsRepo.listActive().find((p) =>
                  p &&
                  p.status !== "CLOSED" &&
                  p.status !== "EXPIRED" &&
                  String(p.symbol || "").toUpperCase() === String(sig.symbol || "").toUpperCase() &&
                  String(p.tf || "").toLowerCase() === String(sig.tf || "").toLowerCase()
                )
              : null);
        } catch {
          return null;
        }
      };

      let samePairOpposite = false;
      try {
        if (secondaryPick && res) {
          const pSym = normSym(res?.symbol);
          const sSym = normSym(secondaryPick?.symbol);
          const pDir = normDir(res?.direction);
          const sDir = normDir(secondaryPick?.direction);
          if (pSym && sSym && pSym === sSym && pDir && sDir && pDir !== sDir) samePairOpposite = true;
        }
      } catch {}

      if (!rotationMode && samePairOpposite) {
        secondaryPick = null;
      }

      // secondary_fill_intraday: fill missing/invalid intraday candidate in rotation mode
      if (rotationMode && (!secondaryPick || samePairOpposite) && typeof this.pipeline.scanBestIntraday === "function") {
        try {
          const primarySym = res?.symbol;
          const exclude = Array.from(new Set([...(activeSymbols || []), primarySym].filter(Boolean)));
          const intr = await this.pipeline.scanBestIntraday({ excludeSymbols: exclude });
          const dup = intr?.ok ? findActiveDup(intr) : null;
          const ok = !!(intr?.ok && !dup);

          scanLog("intraday_fill_attempt", {
            ok,
            symbol: intr?.symbol || null,
            tf: intr?.tf || null,
            dir: normDir(intr?.direction || intr?.dir),
            score: (intr?.score != null ? Math.round(intr.score) : null)
          });

          if (ok) {
            secondaryPick = intr;
          } else if (samePairOpposite) {
            secondaryPick = null;
          }
        } catch {}
      }

      // Ensure required field is persisted (LOCK)
      ensurePlaybook(res);
      ensurePlaybook(secondaryPick);

      // Guardrails + confluence shaping (LOCK)
      let onlyOneCard = applyGuardrails();

      let primarySent = false;
      let secondarySent = false;
      let primaryDuplicatePos = null;
      let secondaryDuplicatePos = null;

      // Prevent duplicate active signals (same Pair + Timeframe) — primary pick
      try {
        const existing = findActiveDup(res);
        if (existing) {
          primaryDuplicatePos = existing;

          await this.signalsRepo.logScanThrottled({
            chatId,
            query: { symbol: symbolUsed || null, tf: res.tf || null, raw: raw || "" },
            meta: { reason: "DUPLICATE_ACTIVE" }
          });

          scanLog("duplicate_primary", { symbol: normSym(res.symbol), tf: String(res.tf || ""), playbook: String(res.playbook || "") });
        }
      } catch {}

      
// If primary is duplicate in rotation-mode /scan, try fallback (LOCK: never stop early)
if (rotationMode && primaryDuplicatePos) {
  const primarySym = res.symbol;
  const secondarySym = secondaryPick?.symbol || null;
  const exclude = Array.from(new Set([...(activeSymbols || []), primarySym, secondarySym].filter(Boolean)));

  // If we already have a non-duplicate Intraday candidate, send it instead of blocking the scan.
  if (secondaryPick) {
    const secondaryDuplicatePos = findActiveDup(secondaryPick);
    if (!secondaryDuplicatePos) {
      scanLog("primary_duplicate_use_secondary", {
        primary: { symbol: primarySym, tf: res.tf },
        secondary: { symbol: secondaryPick.symbol, tf: secondaryPick.tf },
      });

      res = secondaryPick;
      secondaryPick = null;
      onlyOneCard = true;
      primaryDuplicatePos = null;
    }
  }

  // If still duplicate, try an Intraday-only fallback excluding the primary symbol (if supported).
  if (primaryDuplicatePos && typeof this.pipeline.scanBestIntraday === "function") {
    try {
      const intr = await this.pipeline.scanBestIntraday({ excludeSymbols: exclude });
      if (intr?.ok && !findActiveDup(intr)) {
        scanLog("fallback_intraday_found", {
          symbol: intr.symbol,
          tf: intr.tf,
          score: intr.score,
          dir: intr.dir,
        });

        res = intr;
        secondaryPick = null;
        onlyOneCard = true;
        primaryDuplicatePos = null;
      }
    } catch {}
  }

  // If still duplicate, do the original rescan excluding the duplicate symbol(s)
  if (primaryDuplicatePos) {
    scanLog("fallback_rescan_start", { exclude });

    try {
      const dual2 = await this.pipeline.scanBestDual({ excludeSymbols: exclude });

      const primary2 = dual2?.primary || null;
      const secondary2 = dual2?.secondary || null;

      scanLog("fallback_rescan_result", {
        primary: primary2 ? { symbol: primary2.symbol, tf: primary2.tf, dir: primary2.dir } : null,
        secondary: secondary2 ? { symbol: secondary2.symbol, tf: secondary2.tf, dir: secondary2.dir } : null,
      });

      // Prefer primary2 if not duplicate; otherwise prefer secondary2 if not duplicate.
      if (primary2?.ok && !findActiveDup(primary2)) {
        res = primary2;
        secondaryPick = secondary2?.ok ? secondary2 : null;
        primaryDuplicatePos = null;
      } else if (secondary2?.ok && !findActiveDup(secondary2)) {
        res = secondary2;
        secondaryPick = null;
        onlyOneCard = true;
        primaryDuplicatePos = null;
      }
    } catch {}
  }
}

if (primaryDuplicatePos) {
        scanLog("primary_blocked_duplicate", {
          symbol: normSym(res?.symbol),
          tf: String(res?.tf || ""),
          playbook: String(res?.playbook || inferPlaybook(res)).toUpperCase()
        });
      } else {
      // chart FIRST (ENTRY only)
      const overlays = buildOverlays(res);
      const png = await renderEntryChart(res, overlays);
      await this.sender.sendPhoto(chatId, png);

      const entryMsg = await this.sender.sendText(chatId, entryCard(res));

      // counters
      try {
        if (typeof this.stateRepo.bumpScanSignalsSent === "function") this.stateRepo.bumpScanSignalsSent(res.tf);
        else this.stateRepo.bumpScan(res.tf);
        if (typeof this.stateRepo.markSentPairTf === "function") this.stateRepo.markSentPairTf(res.symbol, res.tf);
        await this.stateRepo.flush();
      } catch {}
      // log entry
      await this.signalsRepo.logEntry({
        source: "SCAN",
        signal: res,
        meta: { chatId: String(chatId), raw: raw || "" }
      });

      // create monitored position (notify only requester chat)
      const pos = createPositionFromSignal(res, {
        source: "SCAN",
        notifyChatIds: [String(chatId)],
        telegram: entryMsg?.message_id
          ? { entryMessageIds: { [String(chatId)]: entryMsg.message_id } }
          : null
      });

      // Entry lifecycle normalization (non-breaking, but prevents false TP/SL before entry is filled)
      pos.createdAt = pos.createdAt || Date.now();
      pos.expiresAt = pos.expiresAt || (pos.createdAt + ttlMsForTf(pos.tf));
      if (!pos.filledAt && !pos.hitTP1 && !pos.hitTP2 && !pos.hitTP3) {
        pos.status = "PENDING_ENTRY";
      }

      this.positionsRepo.upsert(pos);
      await this.positionsRepo.flush();
      primarySent = true;
      }

      // Optional secondary card for /scan default (LOCKED): Top 1 Swing + Top 1 Intraday
      if (secondaryPick && secondaryPick.ok && (!onlyOneCard || !primarySent)) {
        // Prevent duplicate active signals (same Pair + Timeframe)
        try {
          const existing =
            (typeof this.positionsRepo.findActiveBySymbolTf === "function"
              ? this.positionsRepo.findActiveBySymbolTf(secondaryPick.symbol, secondaryPick.tf)
              : null) ||
            (Array.isArray(this.positionsRepo.listActive?.())
              ? this.positionsRepo.listActive().find((p) =>
                  p &&
                  p.status !== "CLOSED" &&
                  p.status !== "EXPIRED" &&
                  String(p.symbol || "").toUpperCase() === String(secondaryPick.symbol || "").toUpperCase() &&
                  String(p.tf || "").toLowerCase() === String(secondaryPick.tf || "").toLowerCase()
                )
              : null);

          if (existing) {
            await this.signalsRepo.logScanThrottled({
              chatId,
              query: { symbol: secondaryPick.symbol || null, tf: secondaryPick.tf || null, raw: raw || "" },
              meta: { reason: "DUPLICATE_ACTIVE_SECONDARY" }
            });
            scanLog("duplicate_secondary", { symbol: normSym(secondaryPick.symbol), tf: String(secondaryPick.tf || ""), playbook: String(secondaryPick.playbook || "") });
          } else {
            // chart FIRST (ENTRY only)
            const overlays2 = buildOverlays(secondaryPick);
            const png2 = await renderEntryChart(secondaryPick, overlays2);
            await this.sender.sendPhoto(chatId, png2);

            const entryMsg2 = await this.sender.sendText(chatId, entryCard(secondaryPick));

            // counters
            try {
              if (typeof this.stateRepo.bumpScanSignalsSent === "function") this.stateRepo.bumpScanSignalsSent(secondaryPick.tf);
              else this.stateRepo.bumpScan(secondaryPick.tf);
              if (typeof this.stateRepo.markSentPairTf === "function") this.stateRepo.markSentPairTf(secondaryPick.symbol, secondaryPick.tf);
              await this.stateRepo.flush();
            } catch {}

            // log entry
            await this.signalsRepo.logEntry({
              source: "SCAN",
              signal: secondaryPick,
              meta: { chatId: String(chatId), raw: raw || "" }
            });

            // create monitored position (notify only requester chat)
            const pos2 = createPositionFromSignal(secondaryPick, {
              source: "SCAN",
              notifyChatIds: [String(chatId)],
              telegram: entryMsg2?.message_id
                ? { entryMessageIds: { [String(chatId)]: entryMsg2.message_id } }
                : null
            });

            pos2.createdAt = pos2.createdAt || Date.now();
            pos2.expiresAt = pos2.expiresAt || (pos2.createdAt + ttlMsForTf(pos2.tf));
            if (!pos2.filledAt && !pos2.hitTP1 && !pos2.hitTP2 && !pos2.hitTP3) {
              pos2.status = "PENDING_ENTRY";
            }

            this.positionsRepo.upsert(pos2);
            await this.positionsRepo.flush();
            secondarySent = true;
          }
        } catch {}
      }

      // If primary was blocked by duplicate and no fallback was sent, show Duplicate Prevented (LOCK)
      if (primaryDuplicatePos && !primarySent && !secondarySent) {
        await this.sender.sendText(chatId, formatDuplicateNotice({
          symbol: res.symbol,
          tf: res.tf,
          pos: primaryDuplicatePos
        }));
      }
    });
  }
}
