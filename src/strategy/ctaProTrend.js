import { ema } from "./indicators/ema.js";
import { atr } from "./indicators/atr.js";

// CTA PRO TREND Gate
// Purpose: HTF regime filter + direction lock to prevent opposite-side signals on noisy entry TFs.
// This module is intentionally minimal and does NOT replace your existing scoring engine.

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : NaN;
}

function closes(candles) {
  return (candles || []).map((c) => toNum(c.close)).filter((v) => Number.isFinite(v));
}

function last2(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return [null, null];
  return [arr[arr.length - 2], arr[arr.length - 1]];
}

function crossUp(aPrev, aNow, bPrev, bNow) {
  return aPrev != null && bPrev != null && aNow != null && bNow != null && aPrev <= bPrev && aNow > bNow;
}

function crossDown(aPrev, aNow, bPrev, bNow) {
  return aPrev != null && bPrev != null && aNow != null && bNow != null && aPrev >= bPrev && aNow < bNow;
}

function consecutiveFromEnd(flags, n) {
  if (!Array.isArray(flags) || flags.length < n) return false;
  for (let i = 0; i < n; i++) {
    if (!flags[flags.length - 1 - i]) return false;
  }
  return true;
}

function previousWindowAll(flags, fromEndOffset, len) {
  // window ending at flags.length - 1 - fromEndOffset, of length len
  const end = flags.length - 1 - fromEndOffset;
  const start = Math.max(0, end - len + 1);
  if (end < 0 || end - start + 1 < len) return false;
  for (let i = start; i <= end; i++) {
    if (!flags[i]) return false;
  }
  return true;
}

export function ctaProTrendGate({
  strategy,
  symbol,
  entryTf,
  trendTf,
  klines,
  thresholds = {},
  isAuto = false,
  entryCandles = null
} = {}) {
  const S = String(strategy || "").toUpperCase();
  const enabled = S === "CTA_PRO_TREND" || S === "CTA" || S === "PRO_TREND";
  if (!enabled) return { enabled: false, ok: true, hardBlock: false, softFail: false };

  const M = Number(thresholds.RECLAIM_M ?? 3);
  const K = Number(isAuto ? (thresholds.RECLAIM_K_AUTO ?? 2) : (thresholds.RECLAIM_K_SCAN ?? 1));
  const NO_TRADE_K = Number(thresholds.NO_TRADE_EMA200_ATR_K ?? 0.3);
  const EXTEND_K = Number(thresholds.EXTEND_ATR_K ?? 1.5);

  const entry = entryCandles || klines?.getCandles?.(symbol, entryTf) || [];
  const trend = klines?.getCandles?.(symbol, trendTf) || [];

  // Need enough candles for EMA200 + ATR.
  const minNeed = 220;
  if (entry.length < minNeed || trend.length < minNeed) {
    return {
      enabled: true,
      ok: false,
      hardBlock: true,
      softFail: false,
      reason: "INSUFFICIENT_DATA",
      regime: null,
      direction: null,
      entryTf,
      trendTf,
      metrics: { entryHave: entry.length, trendHave: trend.length, need: minNeed }
    };
  }

  // --- Trend TF regime
  const tCloses = closes(trend);
  const tE200 = ema(tCloses, 200);
  const tE50 = ema(tCloses, 50);
  const tAtr = atr(trend, 14);

  const ti = trend.length - 1;
  const tClose = toNum(trend[ti].close);
  const t200 = tE200[ti];
  const t50 = tE50[ti];
  const tAtr14 = tAtr[ti];

  if (t200 == null || t50 == null || tAtr14 == null || !Number.isFinite(tClose)) {
    return {
      enabled: true,
      ok: false,
      hardBlock: true,
      softFail: false,
      reason: "INDICATORS_NOT_READY",
      regime: null,
      direction: null,
      entryTf,
      trendTf
    };
  }

  const [t50Prev, t50Now] = last2(tE50);
  const slopeUp = t50Prev != null && t50Now != null && t50Now > t50Prev;
  const slopeDown = t50Prev != null && t50Now != null && t50Now < t50Prev;

  const nearE200 = Math.abs(tClose - t200) < (NO_TRADE_K * tAtr14);

  let regime = "NEUTRAL";
  if (!nearE200 && tClose > t200 && t50 > t200 && slopeUp) regime = "BULL";
  if (!nearE200 && tClose < t200 && t50 < t200 && slopeDown) regime = "BEAR";

  if (regime === "NEUTRAL") {
    return {
      enabled: true,
      ok: false,
      hardBlock: true,
      softFail: false,
      reason: nearE200 ? "NO_TRADE_NEAR_EMA200" : "NEUTRAL_REGIME",
      regime,
      direction: null,
      entryTf,
      trendTf,
      metrics: { tClose, t50, t200, tAtr14 }
    };
  }

  const direction = regime === "BULL" ? "LONG" : "SHORT";

  // --- Entry TF reclaim + setup + anti-extended
  const eCloses = closes(entry);
  const eE21 = ema(eCloses, 21);
  const eE50 = ema(eCloses, 50);
  const eAtr = atr(entry, 14);

  const ei = entry.length - 1;
  const eClose = toNum(entry[ei].close);
  const e21 = eE21[ei];
  const e50 = eE50[ei];
  const eAtr14 = eAtr[ei];

  if (e21 == null || e50 == null || eAtr14 == null || !Number.isFinite(eClose)) {
    return {
      enabled: true,
      ok: false,
      hardBlock: true,
      softFail: false,
      reason: "INDICATORS_NOT_READY",
      regime,
      direction,
      entryTf,
      trendTf
    };
  }

  // Reclaim definition
  const aboveE50 = entry.map((c, idx) => toNum(c.close) > eE50[idx]);
  const belowE50 = entry.map((c, idx) => toNum(c.close) < eE50[idx]);

  let reclaimOk = false;
  if (direction === "LONG") {
    reclaimOk = consecutiveFromEnd(aboveE50, K) && previousWindowAll(belowE50, K, M);
  } else {
    reclaimOk = consecutiveFromEnd(belowE50, K) && previousWindowAll(aboveE50, K, M);
  }

  if (!reclaimOk) {
    return {
      enabled: true,
      ok: false,
      hardBlock: false,
      softFail: true,
      reason: "RECLAIM_NOT_CONFIRMED",
      regime,
      direction,
      entryTf,
      trendTf,
      reclaim: { ok: false, M, K },
      metrics: { eClose, e50, e21 }
    };
  }

  // Setup detection
  const last = entry[ei];

  const pullback =
    direction === "LONG"
      ? (toNum(last.low) <= e21 && eClose > e21)
      : (toNum(last.high) >= e21 && eClose < e21);

  const [e21Prev, e21Now] = last2(eE21);
  const [e50Prev, e50Now2] = last2(eE50);

  const cross =
    direction === "LONG"
      ? (crossUp(e21Prev, e21Now, e50Prev, e50Now2) && eClose > e50)
      : (crossDown(e21Prev, e21Now, e50Prev, e50Now2) && eClose < e50);

  const setup = pullback ? "PULLBACK" : (cross ? "CROSS" : null);

  if (!setup) {
    return {
      enabled: true,
      ok: false,
      hardBlock: false,
      softFail: true,
      reason: "NO_SETUP",
      regime,
      direction,
      entryTf,
      trendTf,
      reclaim: { ok: true, M, K },
      setup: { setup: null },
      metrics: { eClose, e50, e21 }
    };
  }

  // Anti-extended filter vs EMA50 in ATR units
  const distToE50 = Math.abs(eClose - e50);
  const extended = distToE50 > (EXTEND_K * eAtr14);

  if (extended) {
    return {
      enabled: true,
      ok: false,
      hardBlock: true,
      softFail: false,
      reason: "TOO_EXTENDED",
      regime,
      direction,
      entryTf,
      trendTf,
      reclaim: { ok: true, M, K },
      setup: { setup },
      metrics: { eClose, e50, eAtr14, distToE50, EXTEND_K }
    };
  }

  return {
    enabled: true,
    ok: true,
    hardBlock: false,
    softFail: false,
    reason: null,
    regime,
    direction,
    entryTf,
    trendTf,
    reclaim: { ok: true, M, K },
    setup: { setup },
    metrics: {
      tClose,
      t50,
      t200,
      tAtr14,
      eClose,
      e50,
      e21,
      eAtr14,
      distToE50,
      NO_TRADE_K,
      EXTEND_K
    }
  };
}
