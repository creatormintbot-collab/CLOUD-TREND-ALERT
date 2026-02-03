import { entryCard } from "./cards/entryCard.js";
import { statusCard } from "./cards/statusCard.js";
import { statusOpenCard } from "./cards/statusOpenCard.js";
import { statusClosedCard } from "./cards/statusClosedCard.js";
import { cohortActiveCard, cohortDetailCard } from "./cards/cohortCard.js";
import { infoCard } from "./cards/infoCard.js";
import { buildOverlays } from "../charts/layout.js";
import { renderEntryChart } from "../charts/renderer.js";
import { createPositionFromSignal } from "../positions/positionModel.js";
import { deriveOutcomeForState, summarizeOutcomesForDay, buildStateFromPosition } from "../positions/outcomes.js";
import { inc as incGroupStat, readDay as readGroupStatsDay } from "../storage/groupStatsRepo.js";
import { INTRADAY_COOLDOWN_MINUTES } from "../config/constants.js";

function mapIntradayPlanToSignal(plan = {}) {
  const entry = Number(plan?.levels?.entry ?? plan?.entry);
  const sl = plan?.levels?.sl ?? plan?.sl;
  const tp1 = plan?.levels?.tp1 ?? plan?.tp1;
  const tp2 = plan?.levels?.tp2 ?? plan?.tp2;
  const tp3 = plan?.levels?.tp3 ?? plan?.tp3;

  const tol = Number(plan?.tolerance);
  const zone = Number.isFinite(tol) ? tol : 0;

  const entryLow = Number.isFinite(entry) ? (entry - zone) : null;
  const entryHigh = Number.isFinite(entry) ? (entry + zone) : null;
  const entryMid = Number.isFinite(entry) ? entry : null;

  const macroBias = plan?.macro?.bias;
  const macro = macroBias ? { BIAS: macroBias } : null;

  const base = {
    symbol: plan.symbol,
    tf: plan.tf || "15m",
    direction: plan.direction,
    playbook: "INTRADAY",
    score: plan.score,
    candleCloseTime: plan.candleCloseTime,
    macro
  };

  // Display includes TP3 to preserve the exact swing-card layout.
  const displaySignal = {
    ...base,
    candles: plan.candles || [],
    levels: { entryLow, entryHigh, entryMid, sl, tp1, tp2, tp3 }
  };

  // Position mirrors the plan levels for follow-up monitoring.
  const positionSignal = {
    ...base,
    levels: { entryLow, entryHigh, entryMid, sl, tp1, tp2, tp3 }
  };

  return { displaySignal, positionSignal };
}
function utcDateKeyNow() {
  return new Date().toISOString().slice(0, 10);
}

function utcTimeNow() {
  return new Date().toISOString().slice(11, 16);
}

const DAY_MS = 86400000;

function utcDateKeyFromMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
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

function parseDateKeyArg(raw) {
  const s = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const ms = Date.parse(`${s}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return null;
  if (utcDateKeyFromMs(ms) !== s) return null;
  return s;
}

function recentUtcRange(endKey, days = 7) {
  const endMs = startOfUtcDayMs(endKey);
  if (!Number.isFinite(endMs)) return { keys: [], startKey: "", endKey: "" };
  const keys = [];
  for (let i = days - 1; i >= 0; i--) {
    keys.push(utcDateKeyFromMs(endMs - i * DAY_MS));
  }
  return { keys, startKey: keys[0], endKey: keys[keys.length - 1] };
}

function yesterdayUtcKeyNow() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
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

function emptyLifecycleStats() {
  return {
    entryHits: 0,
    tp1Hits: 0,
    tp2Hits: 0,
    tp3Hits: 0,
    winCount: 0,
    directSlCount: 0,
    expiredCount: 0,
    tradingClosed: 0
  };
}

async function readLifecycleDayStats(signalsRepo, dayKey) {
  try {
    if (!signalsRepo || typeof signalsRepo.readDay !== "function") return null;
    const dk = String(dayKey || utcDateKeyNow());
    const data = await signalsRepo.readDay(dk);
    const events = Array.isArray(data?.events) ? data.events : [];
    const stats = emptyLifecycleStats();

    for (const ev of events) {
      if (!ev) continue;
      const type = String(ev.type || "").toUpperCase();
      const evt = String(ev.event || "").toUpperCase();
      const typeOk = !type || type === "LIFECYCLE" || type === "TP";

      if (typeOk && evt === "FILLED") stats.entryHits += 1;
      if (typeOk && evt === "TP1") stats.tp1Hits += 1;
      if (typeOk && evt === "TP2") stats.tp2Hits += 1;
      if (typeOk && evt === "TP3") stats.tp3Hits += 1;
    }

    const outcomeSummary = summarizeOutcomesForDay(events, dk);
    return {
      ...stats,
      winCount: outcomeSummary.winCount,
      directSlCount: outcomeSummary.directSlCount,
      expiredCount: outcomeSummary.expiredCount,
      tradingClosed: outcomeSummary.tradingClosed,
      outcomeById: outcomeSummary.outcomeById,
      stateById: outcomeSummary.stateById
    };
  } catch {
    return null;
  }
}

async function readLifecycleRangeStats(signalsRepo, dateKeys = []) {
  const keys = Array.isArray(dateKeys) ? dateKeys : [];
  const totals = emptyLifecycleStats();

  for (const key of keys) {
    const day = await readLifecycleDayStats(signalsRepo, key);
    if (!day) continue;
    totals.entryHits += day.entryHits;
    totals.tp1Hits += day.tp1Hits;
    totals.tp2Hits += day.tp2Hits;
    totals.tp3Hits += day.tp3Hits;
    totals.winCount += day.winCount;
    totals.directSlCount += day.directSlCount;
    totals.expiredCount += day.expiredCount;
    totals.tradingClosed += day.tradingClosed;
  }

  return totals;
}

async function readSignalsRangeStats(signalsRepo, dateKeys = []) {
  const keys = Array.isArray(dateKeys) ? dateKeys : [];
  const totals = {
    autoSent: 0,
    scanSignalsSent: 0,
    scanOk: 0,
    totalCreated: 0
  };

  for (const key of keys) {
    const day = await readSignalsDayStats(signalsRepo, key);
    if (!day) continue;
    totals.autoSent += Number(day.autoSignalsSent || 0);
    totals.scanSignalsSent += Number(day.scanSignalsSent || 0);
    totals.scanOk += Number(day.scanRequestsSuccess || 0);
    totals.totalCreated += Number(day.totalSignalsCreated || (day.autoSignalsSent + day.scanSignalsSent) || 0);
  }

  return totals;
}

function normalizeGroupStats(stats) {
  const s = stats && typeof stats === "object" ? stats : {};
  const toNum = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    autoSignalsSent: toNum(s.autoSignalsSent),
    scanSignalsSent: toNum(s.scanSignalsSent),
    scanRequestsSuccess: toNum(s.scanRequestsSuccess)
  };
}

async function readGroupDayStats(chatId, dateKey) {
  try {
    const day = await readGroupStatsDay(chatId, dateKey);
    return normalizeGroupStats(day);
  } catch {
    return normalizeGroupStats(null);
  }
}

async function resolveCreatedStats({ dateKey, stateRepo, signalsRepo }) {
  const state = await readStateSnapshot(stateRepo);
  const day = pickDayStats(state, dateKey) || {};
  const sigStats = await readSignalsDayStats(signalsRepo, dateKey);

  const autoSent = sigStats
    ? Number(sigStats.autoSignalsSent || 0)
    : (Number(day.autoSignalsSent ?? day.autoSent ?? day.autoTotal ?? 0) || 0);

  const scanOk = sigStats
    ? Number(sigStats.scanRequestsSuccess || 0)
    : (Number(day.scanRequestsSuccess ?? day.scanRequestsOk ?? day.scanOk ?? day.scanRequests ?? day.scanTotal ?? 0) || 0);

  const scanSignalsSent = sigStats
    ? Number(sigStats.scanSignalsSent || 0)
    : (Number(day.scanSignalsSent ?? day.scanSent ?? 0) || 0);

  const totalCreated = sigStats
    ? Number(sigStats.totalSignalsCreated || (autoSent + scanSignalsSent))
    : (Number(day.totalSignalsCreated ?? day.totalSignalsSent ?? (autoSent + scanSignalsSent)) || 0);

  return { autoSent, scanOk, scanSignalsSent, totalCreated, day };
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

function tpHitTs(p, level = 1) {
  const key = level === 3 ? "tp3HitAt" : (level === 2 ? "tp2HitAt" : "tp1HitAt");
  const v = Number(p?.[key] || p?.[`${key}Utc`] || 0);
  return Number.isFinite(v) ? v : 0;
}

function expiredAtTs(p) {
  const a = Number(p?.expiredAt || 0);
  const b = Number(p?.expiredAtUtc || 0);
  const c = Number(p?.closedAt || 0);
  return a || b || c || 0;
}

function closedAtTs(p) {
  const a = Number(p?.closedAt || 0);
  const b = Number(p?.closedAtUtc || 0);
  const c = Number(p?.expiredAt || 0);
  return a || b || c || 0;
}

function isExpiredPos(p) {
  const s = String(p?.status || "").toUpperCase();
  return s === "EXPIRED";
}

function slHit(p) {
  return Boolean(
    p?.hitSL ||
    p?.slHit ||
    p?.slHitAt ||
    p?.slHitAtUtc
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

function normalizeDir(p) {
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
}

function formatPosBase(p) {
  const sym = String(p?.symbol || "").toUpperCase() || "N/A";
  const tf = String(p?.tf || "").toLowerCase() || "N/A";
  const dir = normalizeDir(p);
  return dir ? `${sym} ${dir} (${tf})` : `${sym} (${tf})`;
}

function ageDaysFromMs(createdAtMs, nowKey) {
  const ts = Number(createdAtMs);
  if (!Number.isFinite(ts) || ts <= 0) return 0;
  const createdKey = utcDateKeyFromMs(ts);
  const nowStart = startOfUtcDayMs(nowKey);
  const createdStart = startOfUtcDayMs(createdKey);
  if (!Number.isFinite(nowStart) || !Number.isFinite(createdStart)) return 0;
  return Math.max(0, Math.floor((nowStart - createdStart) / DAY_MS));
}

function formatCreatedMmDd(createdAtMs) {
  const ts = Number(createdAtMs);
  if (!Number.isFinite(ts) || ts <= 0) return "N/A";
  return new Date(ts).toISOString().slice(5, 10);
}

function progressFromPositions(list, dateKey) {
  const rows = Array.isArray(list) ? list : [];
  return {
    entryHits: rows.filter((p) => entryHitTs(p) > 0 && sameUtcDay(entryHitTs(p), dateKey)).length,
    tp1Hits: rows.filter((p) => tpHitTs(p, 1) > 0 && sameUtcDay(tpHitTs(p, 1), dateKey)).length,
    tp2Hits: rows.filter((p) => tpHitTs(p, 2) > 0 && sameUtcDay(tpHitTs(p, 2), dateKey)).length,
    tp3Hits: rows.filter((p) => tpHitTs(p, 3) > 0 && sameUtcDay(tpHitTs(p, 3), dateKey)).length
  };
}

function outcomesFromPositions(list, dateKey) {
  const rows = Array.isArray(list) ? list : [];
  const expiredCount = rows.filter((p) => isExpiredPos(p) && sameUtcDay(expiredAtTs(p), dateKey)).length;
  const tradingClosedList = rows
    .filter((p) => !isExpiredPos(p) && isClosedPos(p))
    .filter((p) => sameUtcDay(closedAtTs(p), dateKey));

  let winCount = 0;
  let directSlCount = 0;

  for (const p of tradingClosedList) {
    const derived = deriveOutcomeForState(buildStateFromPosition(p));
    if (derived.outcome === "WIN") winCount += 1;
    else if (derived.outcome === "LOSS") directSlCount += 1;
  }
  const tradingClosed = winCount + directSlCount;

  return { tradingClosed, winCount, directSlCount, expiredCount };
}

function lifecycleRangeFromPositions(list, dateKeys = []) {
  const keys = Array.isArray(dateKeys) ? dateKeys : [];
  const totals = emptyLifecycleStats();
  for (const key of keys) {
    const prog = progressFromPositions(list, key);
    const out = outcomesFromPositions(list, key);
    totals.entryHits += prog.entryHits;
    totals.tp1Hits += prog.tp1Hits;
    totals.tp2Hits += prog.tp2Hits;
    totals.tp3Hits += prog.tp3Hits;
    totals.winCount += out.winCount;
    totals.directSlCount += out.directSlCount;
    totals.expiredCount += out.expiredCount;
    totals.tradingClosed += out.tradingClosed;
  }
  return totals;
}

function createdRangeFromPositions(list, dateKeys = []) {
  const keys = new Set(Array.isArray(dateKeys) ? dateKeys : []);
  let autoSent = 0;
  let scanSignalsSent = 0;
  let totalCreated = 0;
  const rows = Array.isArray(list) ? list : [];

  for (const p of rows) {
    const createdAt = Number(p?.createdAt || 0);
    if (!Number.isFinite(createdAt) || createdAt <= 0) continue;
    const key = utcDateKeyFromMs(createdAt);
    if (!keys.has(key)) continue;
    totalCreated += 1;
    const src = String(p?.source || "").toUpperCase();
    if (src === "AUTO") autoSent += 1;
    else if (src === "SCAN") scanSignalsSent += 1;
  }

  return { autoSent, scanSignalsSent, totalCreated };
}

function openStatusLabel(p) {
  const t = tpHitMax(p);
  if (t >= 3) return "🥉 TP3";
  if (t === 2) return "🥈 TP2";
  if (t === 1) return "🥇 TP1";
  if (entryHitTs(p) > 0) return "🎯 ENTRY";
  return "🕒 PENDING";
}

function outcomeLabel(p) {
  const derived = deriveOutcomeForState(buildStateFromPosition(p));
  if (derived.labelForList) return derived.labelForList;
  return "CLOSED";
}

function inferPlaybookFromPos(p, secondaryTf) {
  const pb = String(p?.playbook || "").toUpperCase();
  if (pb === "INTRADAY" || pb === "SWING") return pb;
  const tf = String(p?.tf || "").toLowerCase();
  const sec = String(secondaryTf || "4h").toLowerCase();
  return tf === sec ? "SWING" : "INTRADAY";
}

function macroCountsFromDay(day) {
  const m = (day && typeof day === "object") ? (day.macroCounts || day.macro || {}) : {};
  const bull = Number(m.BULLISH ?? m.BULL ?? m.bullish ?? m.bull ?? 0) || 0;
  const bear = Number(m.BEARISH ?? m.BEAR ?? m.bearish ?? m.bear ?? 0) || 0;
  const neutral = Number(m.NEUTRAL ?? m.neutral ?? 0) || 0;
  return { bull, bear, neutral };
}

function summarizeClosed(list) {
  let tp1 = 0;
  let tp2 = 0;
  let tp3 = 0;
  let directSl = 0;
  let giveback = 0;

  for (const p of list) {
    const t = tpHitMax(p);
    const sl = slHit(p);
    if (t >= 3) tp3++;
    else if (t === 2) tp2++;
    else if (t === 1) tp1++;
    else if (sl) directSl++;
    if (sl && t >= 1) giveback++;
  }

  return { tp1, tp2, tp3, directSl, giveback };
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
          "• /statusopen",
          "• /statusclosed",
          "• /cohort",
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
      const chatId = msg.chat.id;
      const dateKey = utcDateKeyNow();
      const timeKey = utcTimeNow();

      const groupStats = await readGroupDayStats(chatId, dateKey);
      const autoSent = groupStats.autoSignalsSent;
      const scanSignalsSent = groupStats.scanSignalsSent;
      const scanOk = groupStats.scanRequestsSuccess;
      const totalCreated = autoSent + scanSignalsSent;

      const all = await listAllPositions(this.positionsRepo);
      const active = Array.isArray(this.positionsRepo.listActive?.()) ? this.positionsRepo.listActive() : all.filter(isActivePos);
      const activeList = Array.isArray(active) ? active : [];
      const startMs = startOfUtcDayMs(dateKey);

      const openFilled = activeList.filter((p) => isActivePos(p) && entryHitTs(p) > 0).length;
      const pendingEntry = activeList.filter((p) => isActivePos(p) && entryHitTs(p) === 0).length;
      const carried = activeList.filter((p) => isActivePos(p) && Number(p?.createdAt || 0) > 0 && Number(p.createdAt) < startMs).length;

      const secondaryTf = String(this.env?.SECONDARY_TIMEFRAME || "4h").toLowerCase();
      const intradayCount = activeList.filter((p) => inferPlaybookFromPos(p, secondaryTf) === "INTRADAY").length;
      const swingCount = activeList.filter((p) => inferPlaybookFromPos(p, secondaryTf) === "SWING").length;

      const lifecycle = await readLifecycleDayStats(this.signalsRepo, dateKey);
      const progressStats = lifecycle || progressFromPositions(all, dateKey);
      const outcomeStats = lifecycle || outcomesFromPositions(all, dateKey);

      const entryHits = Number(progressStats.entryHits || 0);
      const tp1Hits = Number(progressStats.tp1Hits || 0);
      const tp2Hits = Number(progressStats.tp2Hits || 0);
      const tp3Hits = Number(progressStats.tp3Hits || 0);

      const tradingClosed = Number(outcomeStats.tradingClosed || 0);
      const winCount = Number(outcomeStats.winCount || 0);
      const directSlCount = Number(outcomeStats.directSlCount || 0);
      const expiredCount = Number(outcomeStats.expiredCount || 0);

      await this.sender.sendText(
        chatId,
        statusCard({
          dateKey,
          timeKey,
          autoSent,
          scanSignalsSent,
          scanOk,
          totalCreated,
          entryHits,
          tp1Hits,
          tp2Hits,
          tp3Hits,
          tradingClosed,
          winCount,
          directSlCount,
          expiredCount,
          openFilled,
          pendingEntry,
          carried,
          intradayCount,
          swingCount
        })
      );
    });

    this.bot.onText(/^\/statusopen\b/i, async (msg) => {
      const dateKey = utcDateKeyNow();
      const timeKey = utcTimeNow();

      const all = await listAllPositions(this.positionsRepo);
      const active = Array.isArray(this.positionsRepo.listActive?.()) ? this.positionsRepo.listActive() : all.filter(isActivePos);
      const activeList = Array.isArray(active) ? active : [];
      const startMs = startOfUtcDayMs(dateKey);

      const openFilled = activeList.filter((p) => isActivePos(p) && entryHitTs(p) > 0).length;
      const pendingEntry = activeList.filter((p) => isActivePos(p) && entryHitTs(p) === 0).length;
      const carried = activeList.filter((p) => isActivePos(p) && Number(p?.createdAt || 0) > 0 && Number(p.createdAt) < startMs).length;

      const rows = activeList
        .slice()
        .sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0))
        .map((p) => {
          const age = ageDaysFromMs(Number(p?.createdAt || 0), dateKey);
          const created = formatCreatedMmDd(Number(p?.createdAt || 0));
          return `${formatPosBase(p)} — ${openStatusLabel(p)} — age ${age}d — created ${created}`;
        });

      const list = rows.slice(0, 15);
      const moreCount = Math.max(0, rows.length - list.length);

      await this.sender.sendText(
        msg.chat.id,
        statusOpenCard({
          timeKey,
          showing: list.length,
          openFilled,
          pendingEntry,
          carried,
          list,
          moreCount
        })
      );
    });

    this.bot.onText(/^\/statusclosed\b/i, async (msg) => {
      const dateKey = utcDateKeyNow();

      const all = await listAllPositions(this.positionsRepo);
      const lifecycle = await readLifecycleDayStats(this.signalsRepo, dateKey);
      const outcomeById = lifecycle?.outcomeById || null;
      const closedTodayList = (Array.isArray(all) ? all : [])
        .filter((p) => closedAtTs(p) > 0)
        .filter((p) => sameUtcDay(closedAtTs(p), dateKey));

      let tradingClosed = 0;
      let winCount = 0;
      let directSlCount = 0;
      let expiredCount = 0;

      if (lifecycle) {
        tradingClosed = Number(lifecycle.tradingClosed || 0);
        winCount = Number(lifecycle.winCount || 0);
        directSlCount = Number(lifecycle.directSlCount || 0);
        expiredCount = Number(lifecycle.expiredCount || 0);
      } else {
        const tradingClosedList = closedTodayList.filter((p) => !isExpiredPos(p));
        for (const p of tradingClosedList) {
          const derived = deriveOutcomeForState(buildStateFromPosition(p));
          if (derived.outcome === "WIN") winCount += 1;
          else if (derived.outcome === "LOSS") directSlCount += 1;
        }
        tradingClosed = winCount + directSlCount;
        expiredCount = closedTodayList.filter((p) => isExpiredPos(p)).length;
      }
      const rows = closedTodayList
        .slice()
        .sort((a, b) => Number(closedAtTs(b) || 0) - Number(closedAtTs(a) || 0))
        .map((p) => {
          const derived = outcomeById?.[p.id];
          const label = derived?.labelForList || outcomeLabel(p);
          return `${formatPosBase(p)} — ${label}`;
        });

      const list = rows.slice(0, 15);
      const moreCount = Math.max(0, rows.length - list.length);

      await this.sender.sendText(
        msg.chat.id,
        statusClosedCard({
          dateKey,
          tradingClosed,
          winCount,
          directSlCount,
          expiredCount,
          list,
          moreCount
        })
      );
    });

    this.bot.onText(/^\/cohort\b(.*)$/i, async (msg, match) => {
      const raw = (match?.[1] || "").trim();
      const args = raw ? raw.split(/\s+/).filter(Boolean) : [];
      const dateArg = args[0] ? parseDateKeyArg(args[0]) : null;
      const filterArg = String(args[1] || "").toLowerCase();

      const todayKey = utcDateKeyNow();
      const range = recentUtcRange(todayKey, 7);
      const timeKey = utcTimeNow();

      if (!args.length || String(args[0] || "").toLowerCase() === "active") {
        const all = await listAllPositions(this.positionsRepo);
        const active = Array.isArray(this.positionsRepo.listActive?.()) ? this.positionsRepo.listActive() : all.filter(isActivePos);
        const activeList = Array.isArray(active) ? active : [];

        const canUseSignals = this.signalsRepo && typeof this.signalsRepo.readDay === "function";
        const createdStats = canUseSignals
          ? await readSignalsRangeStats(this.signalsRepo, range.keys)
          : createdRangeFromPositions(all, range.keys);
        const lifecycleStats = canUseSignals
          ? await readLifecycleRangeStats(this.signalsRepo, range.keys)
          : lifecycleRangeFromPositions(all, range.keys);

        const totalCreated = Number(createdStats.totalCreated ?? (createdStats.autoSent + createdStats.scanSignalsSent) ?? 0);
        const rows = activeList
          .slice()
          .sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0))
          .map((p) => {
            const age = ageDaysFromMs(Number(p?.createdAt || 0), todayKey);
            const created = formatCreatedMmDd(Number(p?.createdAt || 0));
            return `${formatPosBase(p)} — ${openStatusLabel(p)} — age ${age}d — created ${created}`;
          });

        const list = rows.slice(0, 15);
        const moreCount = Math.max(0, rows.length - list.length);

        await this.sender.sendText(
          msg.chat.id,
          cohortActiveCard({
            timeKey,
            totalCreated,
            autoSent: createdStats.autoSent,
            scanSignalsSent: createdStats.scanSignalsSent,
            entryHits: lifecycleStats.entryHits,
            tp1Hits: lifecycleStats.tp1Hits,
            tp2Hits: lifecycleStats.tp2Hits,
            tp3Hits: lifecycleStats.tp3Hits,
            tradingClosed: lifecycleStats.tradingClosed,
            winCount: lifecycleStats.winCount,
            directSlCount: lifecycleStats.directSlCount,
            expiredCount: lifecycleStats.expiredCount,
            list,
            moreCount
          })
        );
        return;
      }

      if (!dateArg) {
        await this.sender.sendText(
          msg.chat.id,
          "Usage: /cohort or /cohort YYYY-MM-DD [open|closed|recent]"
        );
        return;
      }

      if (!range.keys.includes(dateArg)) {
        await this.sender.sendText(msg.chat.id, "Date out of range. Available: last 7 days (UTC).");
        return;
      }

      const all = await listAllPositions(this.positionsRepo);
      const cohort = (Array.isArray(all) ? all : [])
        .filter((p) => sameUtcDay(Number(p?.createdAt || 0), dateArg));

      const openList = cohort.filter((p) => isActivePos(p));
      const openCount = openList.filter((p) => entryHitTs(p) > 0).length;
      const pendingCount = openList.filter((p) => entryHitTs(p) === 0).length;
      const closedList = cohort.filter(isClosedPos);
      const closedCount = closedList.length;
      const totalCreated = cohort.length;
      const expiredCount = cohort.filter((p) => isExpiredPos(p)).length;
      const entryHits = cohort.filter((p) => entryHitTs(p) > 0).length;
      const tp1Hits = cohort.filter((p) => tpHitTs(p, 1) > 0).length;
      const tp2Hits = cohort.filter((p) => tpHitTs(p, 2) > 0).length;
      const tp3Hits = cohort.filter((p) => tpHitTs(p, 3) > 0).length;

      const tradingClosedList = closedList.filter((p) => !isExpiredPos(p));
      let winCount = 0;
      let directSlCount = 0;
      for (const p of tradingClosedList) {
        const derived = deriveOutcomeForState(buildStateFromPosition(p));
        if (derived.outcome === "WIN") winCount += 1;
        else if (derived.outcome === "LOSS") directSlCount += 1;
      }
      const tradingClosed = winCount + directSlCount;

      const createdStats = await resolveCreatedStats({
        dateKey: dateArg,
        stateRepo: this.stateRepo,
        signalsRepo: this.signalsRepo
      });

      const listMode = ["open", "closed", "recent"].includes(filterArg) ? filterArg : "open";
      let rows = [];

      if (listMode === "closed") {
        rows = closedList
          .slice()
          .sort((a, b) => Number(closedAtTs(b) || 0) - Number(closedAtTs(a) || 0))
          .map((p) => {
            const age = ageDaysFromMs(Number(p?.createdAt || 0), todayKey);
            return `${formatPosBase(p)} — ${outcomeLabel(p)} — age ${age}d`;
          });
      } else if (listMode === "recent") {
        const recent = cohort
          .filter((p) =>
            sameUtcDay(entryHitTs(p), todayKey) ||
            sameUtcDay(closedAtTs(p), todayKey)
          );

        rows = recent
          .slice()
          .sort((a, b) => {
            const aRecent = Math.max(Number(closedAtTs(a) || 0), Number(entryHitTs(a) || 0));
            const bRecent = Math.max(Number(closedAtTs(b) || 0), Number(entryHitTs(b) || 0));
            return bRecent - aRecent;
          })
          .map((p) => {
            const age = ageDaysFromMs(Number(p?.createdAt || 0), todayKey);
            if (isClosedPos(p)) return `${formatPosBase(p)} — ${outcomeLabel(p)} — age ${age}d`;
            if (isActivePos(p)) {
              const created = formatCreatedMmDd(Number(p?.createdAt || 0));
              return `${formatPosBase(p)} — ${openStatusLabel(p)} — age ${age}d — created ${created}`;
            }
            return `${formatPosBase(p)} — EXPIRED (No Entry) — age ${age}d`;
          });
      } else {
        rows = openList
          .slice()
          .sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0))
          .map((p) => {
            const age = ageDaysFromMs(Number(p?.createdAt || 0), todayKey);
            const created = formatCreatedMmDd(Number(p?.createdAt || 0));
            return `${formatPosBase(p)} — ${openStatusLabel(p)} — age ${age}d — created ${created}`;
          });
      }

      const list = rows.slice(0, 15);
      const moreCount = Math.max(0, rows.length - list.length);
      const ageDays = Math.max(0, Math.floor((startOfUtcDayMs(todayKey) - startOfUtcDayMs(dateArg)) / DAY_MS));

      await this.sender.sendText(
        msg.chat.id,
        cohortDetailCard({
          dateKey: dateArg,
          ageDays,
          timeKey,
          totalCreated,
          autoSent: createdStats.autoSent,
          scanSignalsSent: createdStats.scanSignalsSent,
          pendingEntry: pendingCount,
          openFilled: openCount,
          closedCount,
          expiredCount,
          entryHits,
          tp1Hits,
          tp2Hits,
          tp3Hits,
          tradingClosed,
          winCount,
          directSlCount,
          list,
          moreCount
        })
      );
    });

    this.bot.onText(/^\/info\b(.*)$/i, async (msg, match) => {
      const chatId = msg.chat.id;
      const raw = (match?.[1] || "").trim();
      const args = raw ? raw.split(/\s+/).filter(Boolean) : [];

      const todayKey = utcDateKeyNow();
      const range = recentUtcRange(todayKey, 7);
      const validKeys = range.keys.filter((k) => k !== todayKey);
      const defaultKey = validKeys[validKeys.length - 1] || yesterdayUtcKeyNow();

      let dateKey = args.length ? parseDateKeyArg(args[0]) : defaultKey;

      if (!dateKey) {
        await this.sender.sendText(
          chatId,
          "Usage: /info or /info YYYY-MM-DD"
        );
        return;
      }

      if (dateKey === todayKey) {
        await this.sender.sendText(chatId, "Use /status for today. /info is for previous days (UTC).");
        return;
      }

      if (!validKeys.includes(dateKey)) {
        await this.sender.sendText(chatId, "Date out of range. Available: last 7 days (UTC).");
        return;
      }

      const groupStats = await readGroupDayStats(chatId, dateKey);
      const autoSent = groupStats.autoSignalsSent;
      const scanSignalsSent = groupStats.scanSignalsSent;
      const scanOk = groupStats.scanRequestsSuccess;
      const totalCreated = autoSent + scanSignalsSent;

      const createdStats = await resolveCreatedStats({
        dateKey,
        stateRepo: this.stateRepo,
        signalsRepo: this.signalsRepo
      });

      const all = await listAllPositions(this.positionsRepo);
      const lifecycle = await readLifecycleDayStats(this.signalsRepo, dateKey);
      const progressStats = lifecycle || progressFromPositions(all, dateKey);
      const outcomeStats = lifecycle || outcomesFromPositions(all, dateKey);

      const entryHits = Number(progressStats.entryHits || 0);
      const tp1Hits = Number(progressStats.tp1Hits || 0);
      const tp2Hits = Number(progressStats.tp2Hits || 0);
      const tp3Hits = Number(progressStats.tp3Hits || 0);

      const tradingClosed = Number(outcomeStats.tradingClosed || 0);
      const winCount = Number(outcomeStats.winCount || 0);
      const directSlCount = Number(outcomeStats.directSlCount || 0);
      const expiredCount = Number(outcomeStats.expiredCount || 0);
      const macroCounts = macroCountsFromDay(createdStats.day);

      await this.sender.sendText(
        chatId,
        infoCard({
          dateKey,
          totalCreated,
          autoSent,
          scanSignalsSent,
          scanOk,
          entryHits,
          tp1Hits,
          tp2Hits,
          tp3Hits,
          tradingClosed,
          winCount,
          directSlCount,
          expiredCount,
          bullCount: macroCounts.bull,
          bearCount: macroCounts.bear,
          neutralCount: macroCounts.neutral
        })
      );
    });
    this.bot.onText(/^\/scan\b(.*)$/i, async (msg, match) => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id ?? 0;
      const todayKey = utcDateKeyNow();

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
      try {
        await incGroupStat(chatId, todayKey, "scanRequestsSuccess", 1);
      } catch {}


      let symbolUsed = symbolArg || null;
      const rotationMode = !symbolArg;
      const swingTf = String(this.env?.SECONDARY_TIMEFRAME || "4h").toLowerCase();
      const isSwingTfLocal = (tf) => String(tf || "").toLowerCase() === swingTf;

      const startedAt = Date.now();
      let out = null;
      let secondaryPick = null;
      let intradayPlans = [];


      // Rotation mode keeps Progress UI (single edited message).
      if (rotationMode) {
        out = await this.progressUi.run({ chatId, userId }, async () => {
          const lists = await this.pipeline.scanLists({ excludeSymbols: activeSymbols });
          const swingList = Array.isArray(lists?.swing) ? lists.swing : [];
          const intradayList = Array.isArray(lists?.intraday) ? lists.intraday : [];

          intradayPlans = intradayList;
          secondaryPick = null;

          const primary = swingList[0] || null;
          symbolUsed = primary?.symbol || intradayList[0]?.symbol || null;

          if (primary) return primary;
          if (intradayList.length) return { ok: true, __intradayOnly: true };
          return null;
        });
      } else {
        // Targeted /scan (pair / pair+tf) skips Progress UI to avoid double messages
        // and focuses on a single explain/result response.
        try {
          let res = null;

          if (symbolArg && !tfArg) {
            symbolUsed = symbolArg;
            const swing = await this.pipeline.scanPairSwing(symbolArg);
            const intr = await this.pipeline.scanPairIntraday(symbolArg);
            intradayPlans = intr?.ok ? [intr] : [];
            res = swing || (intradayPlans.length ? { ok: true, __intradayOnly: true } : null);
            secondaryPick = null;
          } else {
            symbolUsed = symbolArg;
            if (tfArg && isSwingTfLocal(tfArg)) {
              res = await this.pipeline.scanPairSwing(symbolArg);
            } else {
              const intr = await this.pipeline.scanPairIntraday(symbolArg, tfArg);
              intradayPlans = intr?.ok ? [intr] : [];
              res = intradayPlans.length ? { ok: true, __intradayOnly: true } : null;
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
      const swingRes = (res && res.ok && !res.__intradayOnly) ? res : null;
      const swingOk = !!(swingRes && swingRes.ok && (swingRes.score || 0) >= 70 && swingRes.scoreLabel !== "NO SIGNAL");
      const hasIntraday = Array.isArray(intradayPlans) && intradayPlans.length > 0;
      const intradayOnly = !!(tfArg && !isSwingTfLocal(tfArg));
      const swingOnly = !!(tfArg && isSwingTfLocal(tfArg));
      const dualSections = !tfArg;

      if (!swingOk && !hasIntraday) {
        await this.signalsRepo.logScanNoSignal({
          chatId,
          query: { symbol: symbolUsed || null, tf: tfArg || null, raw: raw || "" },
          elapsedMs: out.elapsedMs,
          meta: { reason: "SCORE_LT_70_OR_INVALID" }
        });

        try {
          if (symbolUsed) {
            if (intradayOnly) {
              await this.sender.sendText(chatId, "No intraday trade plan found.");
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

      // INTRADAY section (Trade Plan)
      if (hasIntraday || dualSections || intradayOnly) {
        const sentSymbols = new Set();
        let intradaySent = 0;

        if (hasIntraday) {
          for (const plan of intradayPlans) {
            const sym = String(plan?.symbol || "").toUpperCase();
            if (!sym || sentSymbols.has(sym)) continue;
            sentSymbols.add(sym);

            const cooldownKey = `${sym}:intraday`;
            const canSend = typeof this.stateRepo?.canSendSymbol === "function"
              ? this.stateRepo.canSendSymbol(cooldownKey, INTRADAY_COOLDOWN_MINUTES)
              : true;
            if (!canSend) continue;

            const { displaySignal, positionSignal } = mapIntradayPlanToSignal(plan);
            // chart FIRST (ENTRY only)
            const overlays = buildOverlays(displaySignal);
            const png = await renderEntryChart(displaySignal, overlays);
            await this.sender.sendPhoto(chatId, png);

            const entryMsg = await this.sender.sendText(chatId, entryCard(displaySignal));
            if (entryMsg) {
              intradaySent++;
              try { await incGroupStat(chatId, todayKey, "scanSignalsSent", 1); } catch {}
            }
            try { this.stateRepo?.markSent?.(cooldownKey); } catch {}

            // Create monitored position for intraday so follow-ups reply to the original signal message.
            try {
              const pos = createPositionFromSignal(positionSignal, {
                source: "SCAN",
                notifyChatIds: [String(chatId)],
                telegram: entryMsg?.message_id
                  ? { entryMessageIds: { [String(chatId)]: entryMsg.message_id } }
                  : null
              });

              pos.createdAt = pos.createdAt || Date.now();
              pos.expiresAt = pos.expiresAt || (pos.createdAt + ttlMsForTf(pos.tf));
              if (!pos.filledAt && !pos.hitTP1 && !pos.hitTP2 && !pos.hitTP3) {
                pos.status = "PENDING_ENTRY";
              }

              this.positionsRepo.upsert(pos);
              await this.positionsRepo.flush();

              await this.signalsRepo.logEntry({
                source: "SCAN",
                signal: positionSignal,
                meta: { chatId: String(chatId), raw: raw || "" }
              });
            } catch {}
          }
        }

        if (!hasIntraday) {
          await this.sender.sendText(chatId, "No intraday trade plan found.");
        }

        if (intradaySent) {
          try { await this.stateRepo.flush(); } catch {}
        }
      }

      if (!swingOk) {
        if (dualSections || swingOnly) {
          await this.sender.sendText(chatId, "No swing signal found.");
        }
        return;
      }

      res = swingRes;


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

      // Intraday plans are handled separately; keep legacy dual-pick logic disabled.
      const allowLegacyDual = false;
      secondaryPick = null;

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
      if (allowLegacyDual && rotationMode && (!secondaryPick || samePairOpposite) && typeof this.pipeline.scanBestIntraday === "function") {
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

      const swingCooldownKey = `${String(res?.symbol || "").toUpperCase()}:swing`;
      const swingCooldownOk = typeof this.stateRepo?.canSendSymbol === "function"
        ? this.stateRepo.canSendSymbol(swingCooldownKey, this.env.COOLDOWN_MINUTES)
        : true;
      if (!swingCooldownOk) {
        try {
          await this.signalsRepo.logScanThrottled({
            chatId,
            query: { symbol: symbolUsed || null, tf: res?.tf || null, raw: raw || "" },
            meta: { reason: "COOLDOWN_SWING" }
          });
        } catch {}
        scanLog("cooldown_swing", { symbol: normSym(res?.symbol), tf: String(res?.tf || "") });
        return;
      }

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
if (allowLegacyDual && rotationMode && primaryDuplicatePos) {
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
      if (entryMsg) {
        try {
          await incGroupStat(chatId, todayKey, "scanSignalsSent", 1);
        } catch {}
      }

      // counters
      try {
        if (typeof this.stateRepo.bumpScanSignalsSent === "function") this.stateRepo.bumpScanSignalsSent(res.tf);
        else this.stateRepo.bumpScan(res.tf);
        if (typeof this.stateRepo.markSentPairTf === "function") this.stateRepo.markSentPairTf(res.symbol, res.tf);
        if (typeof this.stateRepo.markSent === "function") this.stateRepo.markSent(swingCooldownKey);
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
            if (entryMsg2) {
              try {
                await incGroupStat(chatId, todayKey, "scanSignalsSent", 1);
              } catch {}
            }

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
