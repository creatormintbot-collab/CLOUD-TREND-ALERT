import { entryCard } from "./cards/entryCard.js";
import { statusCard } from "./cards/statusCard.js";
import { statusOpenCard } from "./cards/statusOpenCard.js";
import { statusClosedCard } from "./cards/statusClosedCard.js";
import { cohortActiveCard, cohortDetailCard } from "./cards/cohortCard.js";
import { cohortRangeCard } from "./cards/cohortRangeCard.js";
import { infoCard } from "./cards/infoCard.js";
import { buildOverlays } from "../charts/layout.js";
import { renderEntryChart } from "../charts/renderer.js";
import { createPositionFromSignal } from "../positions/positionModel.js";
import { classifyOutcomeFromEvents, OUTCOME_CLASS } from "../positions/outcomes.js";
import { inc as incGroupStat, readDay as readGroupStatsDay, consumeDailyQuota } from "../storage/groupStatsRepo.js";
import { get as getDmFlowState, set as setDmFlowState, clear as clearDmFlowState } from "../storage/dmFlowRepo.js";
import {
  setPending as setPendingSubscription,
  approve as approveSubscription,
  isPremiumActive as isSubscriptionPremiumActive,
  getExpiry as getSubscriptionExpiry
} from "../storage/subscriptionsRepo.js";
import { runPremiumScan } from "../scan/premiumScan.js";
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

function parseRangeDaysArg(raw, { min = 1, max = 30 } = {}) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(d)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (n < min) return min;
  if (n > max) return max;
  return n;
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

function normalizeChatId(chatId) {
  const id = String(chatId ?? "").trim();
  return id || "";
}

function scanNotifyMeta(chatId, entryMsg) {
  const id = String(chatId);
  const msgId = entryMsg?.message_id;
  return {
    notifyChatIds: [id],
    telegram: Number.isFinite(Number(msgId)) ? { entryMessageIds: { [id]: msgId } } : null
  };
}

function positionMatchesChat(pos, chatId) {
  const id = normalizeChatId(chatId);
  if (!id || !pos) return false;

  const notify = Array.isArray(pos.notifyChatIds) ? pos.notifyChatIds.map(String) : [];
  if (notify.includes(id)) return true;

  const entryIds = pos?.telegram?.entryMessageIds;
  if (entryIds && Object.prototype.hasOwnProperty.call(entryIds, id)) return true;

  if (pos?.telegram?.chatId && String(pos.telegram.chatId) === id) return true;
  if (pos?.chatId && String(pos.chatId) === id) return true;

  return false;
}

function filterPositionsForChat(list, chatId) {
  const arr = Array.isArray(list) ? list : [];
  return arr.filter((p) => positionMatchesChat(p, chatId));
}

function filterEventsByScope(events = [], scopeKey) {
  const id = normalizeChatId(scopeKey);
  if (!id) return Array.isArray(events) ? events.slice() : [];

  const out = [];
  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev) continue;

    const chatId = ev.chatId ?? ev.chat_id ?? ev.chat;
    if (chatId !== undefined && String(chatId) === id) {
      out.push(ev);
      continue;
    }

    const notify = ev.notifyChatIds || ev.notifyChats || ev.notifyChatId;
    if (Array.isArray(notify) && notify.map(String).includes(id)) {
      out.push(ev);
      continue;
    }

    const published = ev.publishedTo || ev.published_to || ev.published;
    if (Array.isArray(published) && published.map(String).includes(id)) {
      out.push(ev);
      continue;
    }

    const chats = ev.chatIds || ev.chats;
    if (Array.isArray(chats) && chats.map(String).includes(id)) {
      out.push(ev);
      continue;
    }
  }

  return out;
}

async function readSignalsRangeEvents(signalsRepo, dateKeys = []) {
  if (!signalsRepo || typeof signalsRepo.readDay !== "function") return [];
  const keys = Array.isArray(dateKeys) ? dateKeys : [];
  if (!keys.length) return [];

  const days = await Promise.all(
    keys.map(async (k) => {
      try { return await signalsRepo.readDay(k); } catch { return null; }
    })
  );

  const events = [];
  for (const day of days) {
    if (Array.isArray(day?.events)) events.push(...day.events);
  }
  return events;
}

function summarizeSignalsEvents(events = []) {
  const stats = {
    autoSignalsSent: 0,
    scanRequestsSuccess: 0,
    scanSignalsSent: 0,
    totalSignalsCreated: 0,
    tfBreakdownCreated: { "15m": 0, "30m": 0, "1h": 0, "4h": 0 },
    macroCounts: { BULLISH: 0, BEARISH: 0, NEUTRAL: 0 }
  };

  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev) continue;

    const type = String(ev.type || "").toUpperCase();

    if (type === "ENTRY") {
      const src = String(ev.source || "").toUpperCase();
      if (src === "AUTO") stats.autoSignalsSent++;
      if (src === "SCAN") {
        stats.scanSignalsSent++;
        stats.scanRequestsSuccess++;
      }

      const tf = String(ev.tf || "").toLowerCase();
      if (stats.tfBreakdownCreated[tf] !== undefined) stats.tfBreakdownCreated[tf]++;

      const macroState = String(ev?.macro?.BTC_STATE || ev?.macro?.BTC || ev?.macro?.state || "").toUpperCase();
      if (macroState === "BULLISH") stats.macroCounts.BULLISH++;
      else if (macroState === "BEARISH") stats.macroCounts.BEARISH++;
      else if (macroState === "NEUTRAL") stats.macroCounts.NEUTRAL++;

      stats.totalSignalsCreated++;
      continue;
    }

    if (type === "SCAN_NO_SIGNAL") {
      stats.scanRequestsSuccess++;
      continue;
    }

    if (type === "SCAN_THROTTLED") {
      stats.scanRequestsSuccess++;
      continue;
    }
  }

  return stats;
}


async function readSignalsDayStats(signalsRepo, dayKey, scopeKey = null) {
  try {
    if (!signalsRepo) return null;
    const dk = String(dayKey || utcDateKeyNow());
    if (typeof signalsRepo.readDay !== "function") return null;

    const data = await signalsRepo.readDay(dk);
    const events = Array.isArray(data?.events) ? data.events : [];
    const scoped = filterEventsByScope(events, scopeKey);
    return summarizeSignalsEvents(scoped);
  } catch {
    return null;
  }
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

async function resolveCreatedStats({ dateKey, signalsRepo, scopeKey = null, scopedEvents = null, groupStats = null }) {
  const sigStats = Array.isArray(scopedEvents)
    ? summarizeSignalsEvents(scopedEvents)
    : await readSignalsDayStats(signalsRepo, dateKey, scopeKey);

  const autoSent = Number(sigStats?.autoSignalsSent ?? groupStats?.autoSignalsSent ?? 0) || 0;
  const scanOk = Number(sigStats?.scanRequestsSuccess ?? groupStats?.scanRequestsSuccess ?? 0) || 0;
  const scanSignalsSent = Number(sigStats?.scanSignalsSent ?? groupStats?.scanSignalsSent ?? 0) || 0;
  const totalCreated = Number(sigStats?.totalSignalsCreated ?? (autoSent + scanSignalsSent)) || 0;

  return { autoSent, scanOk, scanSignalsSent, totalCreated, macroCounts: sigStats?.macroCounts };
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
  if (s === "EXPIRED") return false;
  return s === "CLOSED" || s.startsWith("CLOSED") || Number(p?.closedAt || 0) > 0;
}

function outcomeMetaForPos(p, eventsById = null) {
  const events = eventsById instanceof Map ? (eventsById.get(p?.id) || []) : [];
  return classifyOutcomeFromEvents(events, p);
}

function outcomeLabelEmoji(outcomeType) {
  if (outcomeType === OUTCOME_CLASS.WIN_TP1_PLUS) return "🏆 WIN (TP1+)";
  if (outcomeType === OUTCOME_CLASS.LOSS_DIRECT_SL) return "🛑 LOSS (Direct SL)";
  if (outcomeType === OUTCOME_CLASS.EXPIRED_NO_ENTRY) return "⏳ EXPIRED (No entry)";
  return "OPEN";
}

function outcomeClosedAtMs(p, outcomeType) {
  if (outcomeType === OUTCOME_CLASS.EXPIRED_NO_ENTRY) {
    return Number(p?.expiredAt || p?.closedAt || 0) || 0;
  }
  return Number(p?.closedAt || 0) || 0;
}

function outcomeClosedOnDay(p, outcomeType, dateKey) {
  const ts = outcomeClosedAtMs(p, outcomeType);
  return sameUtcDay(ts, dateKey);
}

function entryHitTs(p) {
  const a = Number(p?.entryHitAt || 0);
  const b = Number(p?.filledAt || 0);
  const c = Number(p?.entryFilledAt || 0);
  const d = Number(p?.entryAt || 0);
  return a || b || c || d || 0;
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

function openStateEmoji(p) {
  const tp = tpHitMax(p);
  if (tp >= 3) return "🥇 TP3";
  if (tp === 2) return "🥈 TP2";
  if (tp === 1) return "🥉 TP1";
  if (entryHitTs(p) > 0) return "🎯 ENTRY";
  return "⏳ PENDING";
}

function formatOpenRow(p, nowKey) {
  const age = ageDaysFromMs(Number(p?.createdAt || 0), nowKey);
  const createdKey = utcDateKeyFromMs(Number(p?.createdAt || 0));
  return `${openStateEmoji(p)} ${formatPosBase(p)} — D+${age} | ${createdKey}`;
}

function inferPlaybookFromPos(p, secondaryTf) {
  const pb = String(p?.playbook || "").toUpperCase();
  if (pb === "INTRADAY" || pb === "SWING") return pb;
  const tf = String(p?.tf || "").toLowerCase();
  const sec = String(secondaryTf || "4h").toLowerCase();
  return tf === sec ? "SWING" : "INTRADAY";
}

function indexEventsByPositionId(events = []) {
  const map = new Map();
  for (const ev of Array.isArray(events) ? events : []) {
    const id = ev?.positionId || ev?.posId || ev?.id;
    if (!id) continue;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(ev);
  }
  return map;
}

function summarizeOutcomes(list, eventsById = null) {
  let win = 0;
  let directSl = 0;
  let expired = 0;

  for (const p of Array.isArray(list) ? list : []) {
    const meta = outcomeMetaForPos(p, eventsById);
    const outcome = meta.outcomeType;
    if (outcome === OUTCOME_CLASS.WIN_TP1_PLUS) {
      win++;
    } else if (outcome === OUTCOME_CLASS.LOSS_DIRECT_SL) {
      directSl++;
    } else if (outcome === OUTCOME_CLASS.EXPIRED_NO_ENTRY) {
      expired++;
    }
  }

  return { win, directSl, expired };
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

const DM_START_MENU_TEXT = [
  "CLOUD TREND ALERT",
  "━━━━━━━━━━━━━━━━━━",
  "Hey! Quick thing — to use this bot in DM, please follow our channel first.",
  "After that, you’ll be able to use /scan, /status, and more."
].join("\n");

const DM_NOT_FOLLOWED_BLOCK_TEXT = [
  "CLOUD TREND ALERT",
  "━━━━━━━━━━━━━━━━━━",
  "You’re almost in — please follow our channel first to unlock DM features.",
  "",
  "Tap “Follow Channel”, then come back and hit “Check Access”."
].join("\n");

const DM_ACCESS_GRANTED_TEXT = [
  "✅ Access granted!",
  "Try /scan or /status whenever you’re ready."
].join("\n");

const DM_STILL_NOT_DETECTED_TEXT = [
  "CLOUD TREND ALERT",
  "━━━━━━━━━━━━━━━━━━",
  "Hmm, I still can’t see you as a member yet.",
  "",
  "Please make sure you joined the channel, then tap “Check Access” again."
].join("\n");

const DM_PLAN_PICKER_TEXT = [
  "CLOUD TREND ALERT",
  "━━━━━━━━━━━━━━━━━━",
  "Pick your plan 👇",
  "Premium = unlimited DM scans + you can use the bot in your group (after admin approval)."
].join("\n");

const DM_CONFIRM_ASK_TXID_TEXT = "Cool — please send your TXID here (just paste it as a message).";
const DM_PAYMENT_UNAVAILABLE_TEXT = "Payment is temporarily unavailable. Please try again later.";

const DM_FOLLOW_ALLOWED_STATUSES = new Set(["creator", "administrator", "member"]);
const DM_PLAN_BY_MONTHS = {
  1: { planMonths: 1, priceUsd: 10, planLabel: "1 Month — $10" },
  6: { planMonths: 6, priceUsd: 45, planLabel: "6 Months — $45" },
  12: { planMonths: 12, priceUsd: 60, planLabel: "12 Months — $60" }
};

function dmPlanMetaFromMonths(months) {
  const key = Number(months);
  return DM_PLAN_BY_MONTHS[key] || null;
}

function dmPlanMetaFromState(state) {
  const meta = dmPlanMetaFromMonths(state?.planMonths);
  if (!meta) return null;
  const price = Number(state?.priceUsd);
  if (Number.isFinite(price) && price !== Number(meta.priceUsd)) return null;
  return meta;
}

function dmStartMenuKeyboard(url) {
  return {
    inline_keyboard: [
      [{ text: "Follow Channel", url }],
      [{ text: "I’ve Followed — Check Access", callback_data: "DM:CHECK" }],
      [{ text: "Subscribe", callback_data: "DM:SUB" }]
    ]
  };
}

function dmSubscribePlansKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "1 Month — $10", callback_data: "DM:PLAN:1" }],
      [{ text: "6 Months — $45", callback_data: "DM:PLAN:6" }],
      [{ text: "12 Months — $60", callback_data: "DM:PLAN:12" }]
    ]
  };
}

function dmConfirmKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Confirm", callback_data: "DM:CONFIRM" }]
    ]
  };
}

function dmScanLimitKeyboard(url) {
  return {
    inline_keyboard: [
      [{ text: "Subscribe", callback_data: "DM:SUB" }],
      [
        { text: "Follow Channel", url },
        { text: "I’ve Followed — Check Access", callback_data: "DM:CHECK" }
      ]
    ]
  };
}

function formatDmPaymentInstruction({ amount, plan, usdtAddress }) {
  return [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "Awesome — here’s how to pay:",
    "",
    `Amount: ${amount} USDT`,
    `Plan: ${plan}`,
    "Send to this wallet address:",
    usdtAddress,
    "",
    "After you’ve paid, tap “Confirm” and send your TXID."
  ].join("\n");
}

function formatDmUserTxidReceived({ userId, username, plan, txid, utcIso }) {
  return [
    "✅ Got it!",
    "",
    "Here are your details:",
    `User ID: ${userId}`,
    `Username: @${username}`,
    `Plan: ${plan}`,
    `TXID: ${txid}`,
    `Time (UTC): ${utcIso}`,
    "",
    "Next step:",
    "Please message the admin and send: User ID + TXID",
    "Once verified, your Premium will be unlocked."
  ].join("\n");
}

function formatDmAdminNotify({ userId, username, plan, amount, txid, utcIso, approveCommand }) {
  return [
    "🧾 NEW PREMIUM PAYMENT SUBMITTED",
    "",
    `User ID: ${userId}`,
    `Username: @${username}`,
    `Plan: ${plan}`,
    `Amount: ${amount} USDT`,
    `TXID: ${txid}`,
    `Time (UTC): ${utcIso}`,
    "",
    "Copy to approve:",
    ` ${approveCommand}`,
    "",
    "Action:",
    "Verify payment, then approve using the command above."
  ].join("\n");
}

function formatDmPremiumUnlockedUserText({ expiresAtUtc }) {
  return [
    "✅ Premium unlocked!",
    "",
    "Your Premium is active until:",
    `${expiresAtUtc} (UTC)`,
    "",
    "You now have unlimited DM scans.",
    "For group access, send your Group ID to the admin."
  ].join("\n");
}

function formatDmScanLimitReached({ used, max }) {
  return [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "⚠️ Daily DM Scan Limit Reached (Free)",
    "",
    `You’ve used ${used}/${max} scans today (UTC).`,
    "Want unlimited scans + group access? Tap “Subscribe”."
  ].join("\n");
}

export class Commands {
  constructor({ bot, sender, progressUi, pipeline, stateRepo, positionsRepo, signalsRepo, env, dmSubscribersRepo = null }) {
    this.bot = bot;
    this.sender = sender;
    this.progressUi = progressUi;
    this.pipeline = pipeline;
    this.stateRepo = stateRepo;
    this.positionsRepo = positionsRepo;
    this.signalsRepo = signalsRepo;
    this.env = env;
    this.dmSubscribersRepo = dmSubscribersRepo;
    this._bound = false;
  }

  _isPrivateChat(chat) {
    return String(chat?.type || "").toLowerCase() === "private";
  }

  _subscribeChannelUrl() {
    const raw = String(this.env?.REQUIRED_SUBSCRIBE_CHANNEL_URL || "https://t.me/cloud_trend").trim();
    return raw || "https://t.me/cloud_trend";
  }

  async _sendBotText(chatId, text, options = {}) {
    try {
      return await this.bot.sendMessage(chatId, text, {
        disable_web_page_preview: true,
        ...options
      });
    } catch {
      return null;
    }
  }

  async _sendDmStartMenu(chatId, text = DM_START_MENU_TEXT) {
    return this._sendBotText(chatId, text, {
      reply_markup: dmStartMenuKeyboard(this._subscribeChannelUrl())
    });
  }

  async ensureDmAccess(msg, { silent = false } = {}) {
    if (!this._isPrivateChat(msg?.chat)) return true;

    const requiredChannelId = String(this.env?.REQUIRED_SUBSCRIBE_CHANNEL_ID || "").trim();
    if (!requiredChannelId) return true;

    const userId = msg?.from?.id;
    if (userId === undefined || userId === null) {
      if (!silent) await this._sendDmStartMenu(msg?.chat?.id, DM_NOT_FOLLOWED_BLOCK_TEXT);
      return false;
    }

    try {
      const member = await this.bot.getChatMember(requiredChannelId, userId);
      const status = String(member?.status || "").toLowerCase();
      if (DM_FOLLOW_ALLOWED_STATUSES.has(status)) {
        try { this.dmSubscribersRepo?.add?.(msg?.chat?.id); } catch {}
        return true;
      }
    } catch {}

    if (!silent) await this._sendDmStartMenu(msg?.chat?.id, DM_NOT_FOLLOWED_BLOCK_TEXT);
    return false;
  }

  bind() {
    if (this._bound) return;
    this._bound = true;

    this.bot.onText(/^\/start\b/i, async (msg) => {
      if (!this._isPrivateChat(msg?.chat)) return;
      await this._sendDmStartMenu(msg.chat.id, DM_START_MENU_TEXT);
    });

    this.bot.on("callback_query", async (callbackQuery) => {
      try {
        await this.bot.answerCallbackQuery(callbackQuery?.id).catch(() => {});
      } catch {}

      const data = String(callbackQuery?.data || "");
      if (!data.startsWith("DM:")) return;

      const msg = callbackQuery?.message;
      if (!this._isPrivateChat(msg?.chat)) return;

      const chatId = msg?.chat?.id;
      const userId = callbackQuery?.from?.id;
      if (chatId === undefined || chatId === null || userId === undefined || userId === null) return;

      if (data === "DM:CHECK") {
        const allowed = await this.ensureDmAccess({
          chat: msg.chat,
          from: callbackQuery.from
        }, { silent: true });

        if (allowed) {
          await this._sendBotText(chatId, DM_ACCESS_GRANTED_TEXT);
        } else {
          await this._sendDmStartMenu(chatId, DM_STILL_NOT_DETECTED_TEXT);
        }
        return;
      }

      if (data === "DM:SUB") {
        await this._sendBotText(chatId, DM_PLAN_PICKER_TEXT, {
          reply_markup: dmSubscribePlansKeyboard()
        });
        return;
      }

      const planMatch = data.match(/^DM:PLAN:(1|6|12)$/);
      if (planMatch) {
        const meta = dmPlanMetaFromMonths(Number(planMatch[1]));
        if (!meta) return;

        const usdtAddress = String(this.env?.SUBSCRIBE_USDT_ADDRESS || "").trim();
        if (!usdtAddress) {
          await this._sendBotText(chatId, DM_PAYMENT_UNAVAILABLE_TEXT);
          return;
        }

        await setDmFlowState(userId, {
          stage: "PLAN_SELECTED",
          planMonths: meta.planMonths,
          priceUsd: meta.priceUsd,
          updatedAtUtc: new Date().toISOString()
        }).catch(() => null);

        await this._sendBotText(chatId, formatDmPaymentInstruction({
          amount: meta.priceUsd,
          plan: meta.planLabel,
          usdtAddress
        }), {
          reply_markup: dmConfirmKeyboard()
        });
        return;
      }

      if (data === "DM:CONFIRM") {
        const current = await getDmFlowState(userId).catch(() => null);
        const meta = dmPlanMetaFromState(current);
        if (!meta) {
          await this._sendBotText(chatId, DM_PLAN_PICKER_TEXT, {
            reply_markup: dmSubscribePlansKeyboard()
          });
          return;
        }

        await setDmFlowState(userId, {
          stage: "AWAITING_TXID",
          planMonths: meta.planMonths,
          priceUsd: meta.priceUsd,
          updatedAtUtc: new Date().toISOString()
        }).catch(() => null);

        await this._sendBotText(chatId, DM_CONFIRM_ASK_TXID_TEXT);
      }
    });

    this.bot.on("message", async (msg) => {
      if (!this._isPrivateChat(msg?.chat)) return;

      const text = typeof msg?.text === "string" ? msg.text.trim() : "";
      if (!text || text.startsWith("/")) return;

      const userId = msg?.from?.id;
      if (userId === undefined || userId === null) return;

      const state = await getDmFlowState(userId).catch(() => null);
      if (!state || state.stage !== "AWAITING_TXID") return;

      const txid = text.trim();
      if (txid.length < 8 || /\s/.test(txid)) {
        await this._sendBotText(msg?.chat?.id, "Invalid TXID, please paste again.");
        return;
      }

      const meta = dmPlanMetaFromState(state);
      if (!meta) {
        await clearDmFlowState(userId).catch(() => false);
        return;
      }

      const utcIso = new Date().toISOString();
      await setPendingSubscription({
        userId: String(userId),
        planMonths: meta.planMonths,
        priceUsd: meta.priceUsd,
        txid,
        requestedAtUtc: utcIso
      }).catch(() => null);

      const username = String(msg?.from?.username || "na").trim() || "na";
      const userChatId = msg?.chat?.id;
      const userSummary = formatDmUserTxidReceived({
        userId: String(userId),
        username,
        plan: meta.planLabel,
        txid,
        utcIso
      });

      if (userChatId !== undefined && userChatId !== null) {
        await this._sendBotText(userChatId, userSummary);
      }

      const approveCommand = `/approve ${String(userId)} ${meta.planMonths}`;
      const adminNotify = formatDmAdminNotify({
        userId: String(userId),
        username,
        plan: meta.planLabel,
        amount: meta.priceUsd,
        txid,
        utcIso,
        approveCommand
      });

      const adminIds = Array.from(new Set(
        (Array.isArray(this.env?.ADMIN_USER_IDS) ? this.env.ADMIN_USER_IDS : [])
          .map((id) => String(id || "").trim())
          .filter((id) => /^\d+$/.test(id))
      ));

      await Promise.all(
        adminIds.map((adminId) => this._sendBotText(adminId, adminNotify))
      ).catch(() => {});

      await clearDmFlowState(userId).catch(() => false);
    });

    this.bot.onText(/^\/approve\b(?:\s+(\d+)\s+(1|6|12))?/i, async (msg, match) => {
      const senderId = String(msg?.from?.id || "").trim();
      const adminIds = new Set(
        (Array.isArray(this.env?.ADMIN_USER_IDS) ? this.env.ADMIN_USER_IDS : [])
          .map((id) => String(id || "").trim())
          .filter((id) => /^\d+$/.test(id))
      );

      if (!senderId || !adminIds.has(senderId)) return;

      const targetUserId = String(match?.[1] || "").trim();
      const months = Number(match?.[2]);
      if (!targetUserId || ![1, 6, 12].includes(months)) {
        await this._sendBotText(msg.chat.id, "Usage: /approve <userId> <months>");
        return;
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime());
      expiresAt.setUTCMonth(expiresAt.getUTCMonth() + months);

      const approvedAtUtc = now.toISOString();
      const expiresAtUtc = expiresAt.toISOString();

      const approved = await approveSubscription({
        userId: targetUserId,
        planMonths: months,
        approvedBy: senderId,
        approvedAtUtc,
        expiresAtUtc
      }).catch(() => null);

      if (!approved) {
        await this._sendBotText(msg.chat.id, "Approve failed. Try again.");
        return;
      }

      const activeExpiry = await getSubscriptionExpiry(targetUserId).catch(() => null);
      const finalExpiry = String(activeExpiry || approved.expiresAtUtc || expiresAtUtc);

      await this._sendBotText(targetUserId, formatDmPremiumUnlockedUserText({
        expiresAtUtc: finalExpiry
      }));

      await this._sendBotText(msg.chat.id, [
        "Premium unlocked.",
        `User ID: ${targetUserId}`,
        `Months: ${months}`,
        `Expires At (UTC): ${finalExpiry}`
      ].join("\n"));
    });

    this.bot.onText(/^\/help\b/i, async (msg) => {
      if (!(await this.ensureDmAccess(msg))) return;
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
      if (!(await this.ensureDmAccess(msg))) return;
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
      if (!(await this.ensureDmAccess(msg))) return;
      const chatId = msg.chat.id;
      const dateKey = utcDateKeyNow();
      const timeKey = utcTimeNow();
      const scopeKey = chatId;

      const groupStats = await readGroupDayStats(chatId, dateKey);
      const rangeEvents = await readSignalsRangeEvents(this.signalsRepo, [dateKey]);
      const scopedEvents = filterEventsByScope(rangeEvents, scopeKey);
      const createdStats = await resolveCreatedStats({
        dateKey,
        signalsRepo: this.signalsRepo,
        scopeKey,
        scopedEvents,
        groupStats
      });

      const allRaw = await listAllPositions(this.positionsRepo);
      const all = filterPositionsForChat(allRaw, chatId);
      const activeRaw = Array.isArray(this.positionsRepo.listActive?.()) ? this.positionsRepo.listActive() : all.filter(isActivePos);
      const activeList = filterPositionsForChat(activeRaw, chatId);
      const startMs = startOfUtcDayMs(dateKey);

      const openFilled = activeList.filter((p) => isActivePos(p) && entryHitTs(p) > 0).length;
      const pendingEntry = activeList.filter((p) => isActivePos(p) && entryHitTs(p) === 0).length;
      const carried = activeList.filter((p) => isActivePos(p) && Number(p?.createdAt || 0) > 0 && Number(p.createdAt) < startMs).length;

      const secondaryTf = String(this.env?.SECONDARY_TIMEFRAME || "4h").toLowerCase();
      const intradayCount = activeList.filter((p) => inferPlaybookFromPos(p, secondaryTf) === "INTRADAY").length;
      const swingCount = activeList.filter((p) => inferPlaybookFromPos(p, secondaryTf) === "SWING").length;

      const entryHits = (Array.isArray(all) ? all : [])
        .filter((p) => entryHitTs(p) > 0 && sameUtcDay(entryHitTs(p), dateKey))
        .length;

      const eventsById = indexEventsByPositionId(scopedEvents);

      const closedTodayList = (Array.isArray(all) ? all : [])
        .filter((p) => {
          const meta = outcomeMetaForPos(p, eventsById);
          if (meta.outcomeType === OUTCOME_CLASS.OPEN_OR_UNKNOWN) return false;
          return outcomeClosedOnDay(p, meta.outcomeType, dateKey);
        });

      const closedCounts = summarizeOutcomes(closedTodayList, eventsById);

      await this.sender.sendText(
        chatId,
        statusCard({
          dateKey,
          timeKey,
          autoSent: createdStats.autoSent,
          scanSignalsSent: createdStats.scanSignalsSent,
          scanOk: createdStats.scanOk,
          totalCreated: createdStats.totalCreated,
          entryHits,
          winCount: closedCounts.win,
          directSlCount: closedCounts.directSl,
          expiredCount: closedCounts.expired,
          openFilled,
          pendingEntry,
          carried,
          intradayCount,
          swingCount
        })
      );
    });

    this.bot.onText(/^\/statusopen\b/i, async (msg) => {
      if (!(await this.ensureDmAccess(msg))) return;
      const dateKey = utcDateKeyNow();
      const timeKey = utcTimeNow();
      const scopeKey = msg.chat.id;

      const allRaw = await listAllPositions(this.positionsRepo);
      const all = filterPositionsForChat(allRaw, scopeKey);
      const activeRaw = Array.isArray(this.positionsRepo.listActive?.()) ? this.positionsRepo.listActive() : all.filter(isActivePos);
      const activeList = filterPositionsForChat(activeRaw, scopeKey);
      const startMs = startOfUtcDayMs(dateKey);

      const openFilled = activeList.filter((p) => isActivePos(p) && entryHitTs(p) > 0).length;
      const pendingEntry = activeList.filter((p) => isActivePos(p) && entryHitTs(p) === 0).length;
      const carried = activeList.filter((p) => isActivePos(p) && Number(p?.createdAt || 0) > 0 && Number(p.createdAt) < startMs).length;

      const rows = activeList
        .slice()
        .sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0))
        .map((p) => formatOpenRow(p, dateKey));

      const list = rows.slice(0, 15);
      const moreCount = Math.max(0, rows.length - list.length);

      await this.sender.sendText(
        msg.chat.id,
        statusOpenCard({
          timeKey,
          openFilled,
          pendingEntry,
          carried,
          list,
          moreCount
        })
      );
    });

    this.bot.onText(/^\/statusclosed\b/i, async (msg) => {
      if (!(await this.ensureDmAccess(msg))) return;
      const dateKey = utcDateKeyNow();
      const scopeKey = msg.chat.id;

      const allRaw = await listAllPositions(this.positionsRepo);
      const all = filterPositionsForChat(allRaw, scopeKey);

      const rangeEvents = await readSignalsRangeEvents(this.signalsRepo, [dateKey]);
      const scopedEvents = filterEventsByScope(rangeEvents, scopeKey);
      const eventsById = indexEventsByPositionId(scopedEvents);

      const closedTodayList = (Array.isArray(all) ? all : [])
        .filter((p) => {
          const meta = outcomeMetaForPos(p, eventsById);
          if (meta.outcomeType === OUTCOME_CLASS.OPEN_OR_UNKNOWN) return false;
          return outcomeClosedOnDay(p, meta.outcomeType, dateKey);
        });

      const closedCounts = summarizeOutcomes(closedTodayList, eventsById);
      const rows = closedTodayList
        .slice()
        .sort((a, b) => {
          const aMeta = outcomeMetaForPos(a, eventsById);
          const bMeta = outcomeMetaForPos(b, eventsById);
          return outcomeClosedAtMs(b, bMeta.outcomeType) - outcomeClosedAtMs(a, aMeta.outcomeType);
        })
        .map((p) => {
          const meta = outcomeMetaForPos(p, eventsById);
          return `${formatPosBase(p)} — ${outcomeLabelEmoji(meta.outcomeType)}`;
        });

      const list = rows.slice(0, 15);
      const moreCount = Math.max(0, rows.length - list.length);

      await this.sender.sendText(
        msg.chat.id,
        statusClosedCard({
          dateKey,
          winCount: closedCounts.win,
          directSlCount: closedCounts.directSl,
          expiredCount: closedCounts.expired,
          list,
          moreCount
        })
      );
    });

    this.bot.onText(/^\/cohort\b(.*)$/i, async (msg, match) => {
      if (!(await this.ensureDmAccess(msg))) return;
      const chatId = msg.chat.id;
      const scopeKey = chatId;
      const raw = (match?.[1] || "").trim();
      const args = raw ? raw.split(/\s+/).filter(Boolean) : [];
      const arg0 = String(args[0] || "").trim();
      const dateArg = arg0 ? parseDateKeyArg(arg0) : null;
      const rangeDays = !dateArg ? parseRangeDaysArg(arg0) : null;

      const todayKey = utcDateKeyNow();
      const timeKey = utcTimeNow();

      const allRaw = await listAllPositions(this.positionsRepo);
      const all = filterPositionsForChat(allRaw, scopeKey);

      if (!args.length || arg0.toLowerCase() === "active") {
        const range = recentUtcRange(todayKey, 7);
        const rangeSet = new Set(range.keys);
        const rangeEvents = await readSignalsRangeEvents(this.signalsRepo, range.keys);
        const scopedRangeEvents = filterEventsByScope(rangeEvents, scopeKey);
        const eventsById = indexEventsByPositionId(scopedRangeEvents);

        const cohort = (Array.isArray(all) ? all : [])
          .filter((p) => {
            const createdAt = Number(p?.createdAt || 0);
            if (!Number.isFinite(createdAt) || createdAt <= 0) return false;
            return rangeSet.has(utcDateKeyFromMs(createdAt));
          });

        const createdStats = summarizeSignalsEvents(scopedRangeEvents);

        let entryHits = 0;
        let tp1Hits = 0;
        let tp2Hits = 0;
        let tp3Hits = 0;
        let winCount = 0;
        let directSlCount = 0;
        let expiredCount = 0;

        for (const p of cohort) {
          const meta = outcomeMetaForPos(p, eventsById);
          if (meta.hasEntry) entryHits++;
          if (meta.maxTpHit >= 1) tp1Hits++;
          if (meta.maxTpHit >= 2) tp2Hits++;
          if (meta.maxTpHit >= 3) tp3Hits++;
          if (meta.outcomeType === OUTCOME_CLASS.WIN_TP1_PLUS) winCount++;
          else if (meta.outcomeType === OUTCOME_CLASS.LOSS_DIRECT_SL) directSlCount++;
          else if (meta.outcomeType === OUTCOME_CLASS.EXPIRED_NO_ENTRY) expiredCount++;
        }

        const openList = cohort.filter((p) => isActivePos(p));
        const rows = openList
          .slice()
          .sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0))
          .map((p) => formatOpenRow(p, todayKey));

        const list = rows.slice(0, 15);
        const moreCount = Math.max(0, rows.length - list.length);

        await this.sender.sendText(msg.chat.id, cohortActiveCard({
          timeKey,
          totalCreated: createdStats.totalSignalsCreated,
          autoSent: createdStats.autoSignalsSent,
          scanSignalsSent: createdStats.scanSignalsSent,
          entryHits,
          tp1Hits,
          tp2Hits,
          tp3Hits,
          winCount,
          directSlCount,
          expiredCount,
          list,
          moreCount
        }));
        return;
      }

      if (rangeDays) {
        const range = recentUtcRange(todayKey, rangeDays);
        const rangeSet = new Set(range.keys);
        const rawRangePositions = typeof this.positionsRepo.listByCreatedDayRange === "function"
          ? this.positionsRepo.listByCreatedDayRange(range.startKey, range.endKey)
          : (Array.isArray(all) ? all : []).filter((p) => {
              const createdAt = Number(p?.createdAt || 0);
              if (!Number.isFinite(createdAt) || createdAt <= 0) return false;
              const key = utcDateKeyFromMs(createdAt);
              return rangeSet.has(key);
            });

        const rangePositions = filterPositionsForChat(rawRangePositions, scopeKey);
        const byDay = new Map();
        for (const key of range.keys) {
          byDay.set(key, { created: 0, entry: 0, win: 0, loss: 0, expired: 0 });
        }

        for (const p of rangePositions) {
          const createdAt = Number(p?.createdAt || 0);
          if (!Number.isFinite(createdAt) || createdAt <= 0) continue;
          const createdKey = utcDateKeyFromMs(createdAt);
          if (!rangeSet.has(createdKey)) continue;
          const meta = outcomeMetaForPos(p, null);
          const day = byDay.get(createdKey);
          if (!day) continue;
          day.created++;
          if (meta.hasEntry) day.entry++;
          if (meta.outcomeType === OUTCOME_CLASS.WIN_TP1_PLUS) day.win++;
          else if (meta.outcomeType === OUTCOME_CLASS.LOSS_DIRECT_SL) day.loss++;
          else if (meta.outcomeType === OUTCOME_CLASS.EXPIRED_NO_ENTRY) day.expired++;
        }

        const rows = range.keys.map((key) => {
          const day = byDay.get(key) || { created: 0, entry: 0, win: 0, loss: 0, expired: 0 };
          const closed = day.win + day.loss;
          const winrate = closed > 0 ? ((day.win / closed) * 100).toFixed(1) + "%" : "N/A";
          return `• ${key} — created ${day.created} | entry ${day.entry} | closed ${closed} (W ${day.win} | L ${day.loss}) | exp ${day.expired} | WR ${winrate}`;
        });

        const totals = { created: 0, entry: 0, win: 0, loss: 0, expired: 0 };
        for (const key of range.keys) {
          const day = byDay.get(key);
          if (!day) continue;
          totals.created += day.created;
          totals.entry += day.entry;
          totals.win += day.win;
          totals.loss += day.loss;
          totals.expired += day.expired;
        }

        await this.sender.sendText(msg.chat.id, cohortRangeCard({
          days: range.keys.length,
          startKey: range.startKey,
          endKey: range.endKey,
          timeKey,
          rows,
          totals
        }));
        return;
      }

      if (!dateArg) {
        await this.sender.sendText(
          msg.chat.id,
          "Usage: /cohort | /cohort YYYY-MM-DD | /cohort Nd"
        );
        return;
      }

      const cohortRaw = typeof this.positionsRepo.listByCreatedDay === "function"
        ? this.positionsRepo.listByCreatedDay(dateArg)
        : (Array.isArray(all) ? all : []).filter((p) => sameUtcDay(Number(p?.createdAt || 0), dateArg));

      const cohort = filterPositionsForChat(cohortRaw, scopeKey);
      const dayEvents = filterEventsByScope(await readSignalsRangeEvents(this.signalsRepo, [dateArg]), scopeKey);
      const createdStats = await resolveCreatedStats({
        dateKey: dateArg,
        signalsRepo: this.signalsRepo,
        scopeKey,
        scopedEvents: dayEvents
      });

      let winCount = 0;
      let directSlCount = 0;
      let expiredCount = 0;
      let activeCount = 0;

      const activeRows = [];
      const closedRows = [];

      for (const p of cohort) {
        const meta = outcomeMetaForPos(p, null);
        if (meta.outcomeType === OUTCOME_CLASS.WIN_TP1_PLUS) winCount++;
        else if (meta.outcomeType === OUTCOME_CLASS.LOSS_DIRECT_SL) directSlCount++;
        else if (meta.outcomeType === OUTCOME_CLASS.EXPIRED_NO_ENTRY) expiredCount++;
        else activeCount++;

        if (meta.outcomeType === OUTCOME_CLASS.OPEN_OR_UNKNOWN) {
          activeRows.push({ pos: p });
        } else {
          closedRows.push({ pos: p, outcomeType: meta.outcomeType });
        }
      }

      const activeList = activeRows
        .slice()
        .sort((a, b) => Number(b?.pos?.createdAt || 0) - Number(a?.pos?.createdAt || 0))
        .map((row) => formatOpenRow(row.pos, todayKey));

      const closedList = closedRows
        .slice()
        .sort((a, b) => outcomeClosedAtMs(b.pos, b.outcomeType) - outcomeClosedAtMs(a.pos, a.outcomeType))
        .map((row) => {
          const age = ageDaysFromMs(Number(row.pos?.createdAt || 0), todayKey);
          const createdKey = utcDateKeyFromMs(Number(row.pos?.createdAt || 0));
          return `${formatPosBase(row.pos)} — ${outcomeLabelEmoji(row.outcomeType)} — D+${age} | ${createdKey}`;
        });

      const activeTop = activeList.slice(0, 10);
      const closedTop = closedList.slice(0, 10);
      const moreActiveCount = Math.max(0, activeList.length - activeTop.length);
      const moreClosedCount = Math.max(0, closedList.length - closedTop.length);

      await this.sender.sendText(
        msg.chat.id,
        cohortDetailCard({
          dateKey: dateArg,
          timeKey,
          createdCount: cohort.length,
          totalCreated: createdStats.totalCreated,
          autoSent: createdStats.autoSent,
          scanSignalsSent: createdStats.scanSignalsSent,
          winCount,
          directSlCount,
          expiredCount,
          activeCount,
          closedCount: winCount + directSlCount,
          activeList: activeTop,
          closedList: closedTop,
          moreActiveCount,
          moreClosedCount
        })
      );
    });

    this.bot.onText(/^\/info\b(.*)$/i, async (msg, match) => {
      if (!(await this.ensureDmAccess(msg))) return;
      const chatId = msg.chat.id;
      const scopeKey = chatId;
      const raw = (match?.[1] || "").trim();
      const args = raw ? raw.split(/\s+/).filter(Boolean) : [];

      const todayKey = utcDateKeyNow();
      const generatedKey = todayKey;
      const generatedTime = utcTimeNow();
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
      const dayEvents = filterEventsByScope(await readSignalsRangeEvents(this.signalsRepo, [dateKey]), scopeKey);
      const createdStats = await resolveCreatedStats({
        dateKey,
        signalsRepo: this.signalsRepo,
        scopeKey,
        scopedEvents: dayEvents,
        groupStats
      });

      const allRaw = await listAllPositions(this.positionsRepo);
      const all = filterPositionsForChat(allRaw, scopeKey);
      const entryHits = (Array.isArray(all) ? all : [])
        .filter((p) => entryHitTs(p) > 0 && sameUtcDay(entryHitTs(p), dateKey))
        .length;

      const eventsById = indexEventsByPositionId(dayEvents);

      const closedList = (Array.isArray(all) ? all : [])
        .filter((p) => {
          const meta = outcomeMetaForPos(p, eventsById);
          if (meta.outcomeType === OUTCOME_CLASS.OPEN_OR_UNKNOWN) return false;
          return outcomeClosedOnDay(p, meta.outcomeType, dateKey);
        });

      const closedCounts = summarizeOutcomes(closedList, eventsById);

      await this.sender.sendText(
        chatId,
        infoCard({
          dateKey,
          generatedKey,
          generatedTime,
          totalCreated: createdStats.totalCreated,
          autoSent: createdStats.autoSent,
          scanSignalsSent: createdStats.scanSignalsSent,
          scanOk: createdStats.scanOk,
          entryHits,
          winCount: closedCounts.win,
          directSlCount: closedCounts.directSl,
          expiredCount: closedCounts.expired
        })
      );
    });
    this.bot.onText(/^\/scan\b(.*)$/i, async (msg, match) => {
      if (!(await this.ensureDmAccess(msg))) return;

      const chatId = msg.chat.id;
      const userId = msg.from?.id ?? 0;
      const todayKey = utcDateKeyNow();

      const raw = (match?.[1] || "").trim();
      const args = raw ? raw.split(/\s+/).filter(Boolean) : [];
      const symbolArg = args[0]?.toUpperCase();
      let tfArg = args[1]?.toLowerCase();
      const isDmChat = this._isPrivateChat(msg?.chat);
      const isPremium = isDmChat
        ? await isSubscriptionPremiumActive(String(userId)).catch(() => false)
        : false;
      const dmScanMax = Math.max(0, Math.floor(Number(this.env?.DM_SCAN_MAX_PER_DAY ?? 5)));

      const premiumValidTfs = new Set(["15m", "30m", "1h", "4h"]);
      let requestedPremiumTfs = null;

      if (isDmChat && !isPremium && args.length > 0) {
        await this._sendBotText(chatId, DM_PLAN_PICKER_TEXT, {
          reply_markup: dmScanLimitKeyboard(this._subscribeChannelUrl())
        });
        return;
      }

      if (isDmChat && isPremium && symbolArg) {
        if (args.length <= 1) {
          requestedPremiumTfs = ["15m", "30m", "1h", "4h"];
          tfArg = null;
        } else {
          const parsed = args.slice(1).map((tf) => String(tf || "").toLowerCase());
          const invalid = parsed.filter((tf) => !premiumValidTfs.has(tf));
          if (invalid.length) {
            await this.sender.sendText(chatId, [
              "CLOUD TREND ALERT",
              "━━━━━━━━━━━━━━━━━━",
              "⚠️ INVALID TIMEFRAME",
              `Provided: ${invalid.join(", ")}`,
              "Allowed: 15m, 30m, 1h, 4h",
              "",
              "Usage:",
              "• /scan BTCUSDT",
              "• /scan BTCUSDT 15m",
              "• /scan BTCUSDT 1h",
              `• /scan BTCUSDT ${String(this.env?.SECONDARY_TIMEFRAME || "4h")}`
            ].join("\n"));
            return;
          }
          requestedPremiumTfs = Array.from(new Set(parsed));
          tfArg = requestedPremiumTfs.length === 1 ? requestedPremiumTfs[0] : null;
        }
      }

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

      if (!requestedPremiumTfs && tfArg && !allowedTfs.includes(tfArg)) {
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

      const premiumManualDmScan = isDmChat && isPremium && !!symbolArg;
      if (premiumManualDmScan) {
        const normalizeTfKey = (tfs) => {
          const order = ["15m", "30m", "1h", "4h"];
          const uniq = Array.from(new Set((Array.isArray(tfs) ? tfs : [])
            .map((tf) => String(tf || "").toLowerCase())
            .filter(Boolean)));
          uniq.sort((a, b) => {
            const ai = order.indexOf(a);
            const bi = order.indexOf(b);
            if (ai === -1 && bi === -1) return a.localeCompare(b);
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
          });
          return uniq.join(",");
        };
        const tfKey = (args.length <= 1)
          ? "harmonic"
          : (normalizeTfKey(requestedPremiumTfs) || "harmonic");
        const throttleKey = `dm:${String(userId)}:scan:${String(symbolArg || "").toUpperCase()}:${tfKey}`;
        const canSend = (typeof this.stateRepo?.canSendSymbol === "function")
          ? this.stateRepo.canSendSymbol(throttleKey, 0.75)
          : true;
        if (!canSend) {
          await this.sender.sendText(chatId, `⏳ Cooldown 45s. Please wait before scanning ${String(symbolArg || "").toUpperCase()} again.`);
          return;
        }
        try {
          if (typeof this.stateRepo?.markSent === "function") {
            this.stateRepo.markSent(throttleKey);
            await this.stateRepo.flush();
          }
        } catch {}
      }

      const shouldApplyFreeDmQuota = isDmChat && !isPremium && !symbolArg;
      const bypassIntradayCooldown = premiumManualDmScan;
      if (shouldApplyFreeDmQuota) {
        const quota = await consumeDailyQuota(chatId, todayKey, "dmScanUsed", dmScanMax)
          .catch(() => ({ ok: false, used: dmScanMax, max: dmScanMax, nextUsed: dmScanMax }));
        if (!quota?.ok) {
          const used = Number.isFinite(Number(quota?.used)) ? Number(quota.used) : dmScanMax;
          const max = Number.isFinite(Number(quota?.max)) ? Number(quota.max) : dmScanMax;
          await this._sendBotText(chatId, formatDmScanLimitReached({
            used,
            max
          }), {
            reply_markup: dmScanLimitKeyboard(this._subscribeChannelUrl())
          });
          return;
        }
      }

      // Count accepted /scan requests (UTC day).
      try {
        if (typeof this.stateRepo.bumpScanRequest === "function") {
          this.stateRepo.bumpScanRequest();
          await this.stateRepo.flush();
        }
      } catch {}
      try {
        if (!shouldApplyFreeDmQuota && !isDmChat) {
          await incGroupStat(chatId, todayKey, "scanRequestsSuccess", 1);
        }
      } catch {}


      let symbolUsed = symbolArg || null;
      const rotationMode = !symbolArg;
      const swingTf = String(this.env?.SECONDARY_TIMEFRAME || "4h").toLowerCase();
      const isSwingTfLocal = (tf) => String(tf || "").toLowerCase() === swingTf;
      const normSide = (d) => {
        const x = String(d || "").toUpperCase();
        if (!x) return "";
        if (x.startsWith("LONG") || x === "L") return "LONG";
        if (x.startsWith("SHORT") || x === "S") return "SHORT";
        return x;
      };
      const inferPlaybookForDup = (sig) => {
        const pb = String(sig?.playbook || "").toUpperCase();
        if (pb) return pb;
        const tf = String(sig?.tf || "").toLowerCase();
        if (!tf) return "";
        return isSwingTfLocal(tf) ? "SWING" : "INTRADAY";
      };
      const findActiveDupByKey = (sig) => {
        if (!sig) return null;
        try {
          const s = String(sig?.symbol || "").toUpperCase();
          const t = String(sig?.tf || "").toLowerCase();
          const d = normSide(sig?.direction ?? sig?.dir);
          const pb = inferPlaybookForDup(sig);
          if (!s || !t || !d || !pb) return null;
          const list = Array.isArray(this.positionsRepo.listActive?.()) ? this.positionsRepo.listActive() : [];
          return list.find((p) => {
            if (!p || p.status === "CLOSED" || p.status === "EXPIRED") return false;
            const ps = String(p.symbol || "").toUpperCase();
            const pt = String(p.tf || "").toLowerCase();
            const pd = normSide(p.direction ?? p.dir);
            const ppb = String(p.playbook || "").toUpperCase() || (isSwingTfLocal(pt) ? "SWING" : "INTRADAY");
            return ps === s && pt === t && pd === d && ppb === pb;
          }) || null;
        } catch {
          return null;
        }
      };

      const startedAt = Date.now();
      let out = null;
      let secondaryPick = null;
      let intradayPlans = [];
      let rotationSwingCandidates = [];


      // Rotation mode keeps Progress UI (single edited message).
      if (rotationMode) {
        out = await this.progressUi.run({ chatId, userId }, async () => {
          const lists = await this.pipeline.scanLists({ excludeSymbols: activeSymbols });
          const swingList = Array.isArray(lists?.swing) ? lists.swing : [];
          const intradayList = Array.isArray(lists?.intraday) ? lists.intraday : [];

          rotationSwingCandidates = swingList;
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

          if (isDmChat && isPremium && symbolArg) {
            symbolUsed = symbolArg;
            const requestedTfs = Array.isArray(requestedPremiumTfs) && requestedPremiumTfs.length
              ? requestedPremiumTfs
              : ["15m", "30m", "1h", "4h"];

            const premiumRes = await runPremiumScan({
              symbol: symbolArg,
              tfs: requestedTfs,
              pipeline: this.pipeline,
              env: this.env,
              scoreThreshold: 80
            });

            intradayPlans = Array.isArray(premiumRes?.intradayPlans) ? premiumRes.intradayPlans : [];
            let swing = premiumRes?.swingSignal?.ok ? premiumRes.swingSignal : null;

            if (!intradayPlans.length && !swing) {
              const fallbackIntraday = [];
              for (const tf of requestedTfs) {
                if (isSwingTfLocal(tf)) continue;
                const intr = await this.pipeline.scanPairIntraday(symbolArg, tf);
                if (intr?.ok) fallbackIntraday.push(intr);
              }

              if (requestedTfs.some((tf) => isSwingTfLocal(tf))) {
                const fallbackSwing = await this.pipeline.scanPairSwing(symbolArg);
                if (fallbackSwing?.ok) swing = fallbackSwing;
              }

              intradayPlans = fallbackIntraday;
            }

            res = swing || (intradayPlans.length ? { ok: true, __intradayOnly: true } : null);
            secondaryPick = null;
          } else if (symbolArg && !tfArg) {
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
      const premiumRequestedSet = Array.isArray(requestedPremiumTfs) && requestedPremiumTfs.length
        ? requestedPremiumTfs
        : null;
      const premiumWantsIntraday = premiumRequestedSet
        ? premiumRequestedSet.some((tf) => !isSwingTfLocal(tf))
        : false;
      const premiumWantsSwing = premiumRequestedSet
        ? premiumRequestedSet.some((tf) => isSwingTfLocal(tf))
        : false;
      const shouldShowIntradaySection = premiumRequestedSet
        ? premiumWantsIntraday
        : (hasIntraday || dualSections || intradayOnly);
      const shouldShowSwingSection = premiumRequestedSet
        ? premiumWantsSwing
        : (dualSections || swingOnly);
      const suppressRotationSectionText = rotationMode && !isDmChat;

      if (!swingOk && !hasIntraday) {
        await this.signalsRepo.logScanNoSignal({
          chatId,
          query: { symbol: symbolUsed || null, tf: tfArg || null, raw: raw || "" },
          elapsedMs: out.elapsedMs,
          meta: { reason: "SCORE_LT_70_OR_INVALID" }
        });

        try {
          if (symbolUsed) {
            if (intradayOnly || (premiumRequestedSet && !premiumWantsSwing)) {
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
      if (shouldShowIntradaySection) {
        const sentPlanKeys = new Set();
        let intradaySent = 0;

        if (hasIntraday) {
          for (const plan of intradayPlans) {
            const sym = String(plan?.symbol || "").toUpperCase();
            const planTf = String(plan?.tf || "").toLowerCase() || "15m";
            const sentKey = `${sym}:${planTf}`;
            if (!sym || sentPlanKeys.has(sentKey)) continue;
            sentPlanKeys.add(sentKey);

            const cooldownKey = `${sym}:${planTf}:intraday`;
            const dmCooldownKey = `dm:${String(userId)}:${sym}:${planTf}:intraday`;
            const canSend = bypassIntradayCooldown
              ? true
              : (typeof this.stateRepo?.canSendSymbol === "function"
                ? this.stateRepo.canSendSymbol(cooldownKey, INTRADAY_COOLDOWN_MINUTES)
                : true);
            if (!canSend) continue;

            const { displaySignal, positionSignal } = mapIntradayPlanToSignal(plan);
            if (premiumManualDmScan) {
              const dupPos = findActiveDupByKey(positionSignal);
              if (dupPos) {
                const sideLabel = normSide(positionSignal.direction ?? positionSignal.dir) || String(positionSignal.direction || positionSignal.dir || "").toUpperCase();
                await this.sender.sendText(chatId, `✅ Already active: ${sym} ${planTf} ${sideLabel}. Use /status to see the running plan.`);
                continue;
              }
            }
            // chart FIRST (ENTRY only)
            const overlays = buildOverlays(displaySignal);
            const png = await renderEntryChart(displaySignal, overlays);
            await this.sender.sendPhoto(chatId, png);

            const entryMsg = await this.sender.sendText(chatId, entryCard(displaySignal));
            if (entryMsg) {
              intradaySent++;
              try { await incGroupStat(chatId, todayKey, "scanSignalsSent", 1); } catch {}
            }
            try {
              if (typeof this.stateRepo?.markSent === "function") {
                if (premiumManualDmScan) this.stateRepo.markSent(dmCooldownKey);
                if (!premiumManualDmScan) this.stateRepo.markSent(cooldownKey);
              }
            } catch {}

            // Create monitored position for intraday so follow-ups reply to the original signal message.
            try {
              const pos = createPositionFromSignal(positionSignal, {
                source: "SCAN",
                ...scanNotifyMeta(chatId, entryMsg)
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
          if (!suppressRotationSectionText) {
            await this.sender.sendText(chatId, "No intraday trade plan found.");
          }
        }

        if (intradaySent) {
          try { await this.stateRepo.flush(); } catch {}
        }
      }

      if (!swingOk) {
        if (shouldShowSwingSection && !suppressRotationSectionText) {
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

      if (rotationMode && !isDmChat && Array.isArray(rotationSwingCandidates) && rotationSwingCandidates.length) {
        const fallbackSwing = rotationSwingCandidates.find((sig) => {
          if (!(sig && sig.ok && (sig.score || 0) >= 70 && sig.scoreLabel !== "NO SIGNAL")) return false;
          if (findActiveDupByKey(sig)) return false;
          if (typeof this.stateRepo?.canSendSymbol !== "function") return true;
          const key = `${String(sig?.symbol || "").toUpperCase()}:swing`;
          return this.stateRepo.canSendSymbol(key, this.env.COOLDOWN_MINUTES);
        }) || null;

        if (fallbackSwing) {
          res = fallbackSwing;
          symbolUsed = fallbackSwing?.symbol || symbolUsed;
          ensurePlaybook(res);
        }
      }

      const swingCooldownKey = `${String(res?.symbol || "").toUpperCase()}:swing`;
      const swingCooldownOk = (typeof this.stateRepo?.canSendSymbol === "function"
        ? this.stateRepo.canSendSymbol(swingCooldownKey, this.env.COOLDOWN_MINUTES)
        : true);
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
      const useStrictDupGuard = premiumManualDmScan || (rotationMode && !isDmChat);
      const findActiveDupForSignal = (sig) => (useStrictDupGuard ? findActiveDupByKey(sig) : findActiveDup(sig));

      // Prevent duplicate active signals (same Pair + Timeframe) — primary pick
      try {
        const existing = findActiveDupForSignal(res);
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
        if (!premiumManualDmScan && typeof this.stateRepo.markSentPairTf === "function") this.stateRepo.markSentPairTf(res.symbol, res.tf);
        if (typeof this.stateRepo.markSent === "function") {
          if (premiumManualDmScan) {
            this.stateRepo.markSent(`dm:${String(userId)}:${String(res?.symbol || "").toUpperCase()}:swing`);
          } else {
            this.stateRepo.markSent(swingCooldownKey);
          }
        }
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
        ...scanNotifyMeta(chatId, entryMsg)
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
            findActiveDupForSignal(secondaryPick);

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
              if (!premiumManualDmScan && typeof this.stateRepo.markSentPairTf === "function") this.stateRepo.markSentPairTf(secondaryPick.symbol, secondaryPick.tf);
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
              ...scanNotifyMeta(chatId, entryMsg2)
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
      if (primaryDuplicatePos && !primarySent && !secondarySent && (!rotationMode || isDmChat)) {
        if (premiumManualDmScan) {
          const sideLabel = normSide(res?.direction ?? res?.dir) || String(res?.direction || res?.dir || "").toUpperCase();
          await this.sender.sendText(chatId, `✅ Already active: ${String(res?.symbol || "").toUpperCase()} ${String(res?.tf || "").toLowerCase()} ${sideLabel}. Use /status to see the running plan.`);
        } else {
          await this.sender.sendText(chatId, formatDuplicateNotice({
            symbol: res.symbol,
            tf: res.tf,
            pos: primaryDuplicatePos
          }));
        }
      }
    });
  }
}
