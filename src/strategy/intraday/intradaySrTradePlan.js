import { ema } from "../indicators/ema.js";
import { atr } from "../indicators/atr.js";
import { buildSrLevels } from "../indicators/srLevels.js";
import { intradayScore } from "../scoring/intradayScore.js";
import { fmtPrice } from "../../utils/format.js";
import {
  INTRADAY_RR_CAP,
  INTRADAY_SR_PIVOT_L,
  INTRADAY_SR_PIVOT_R,
  INTRADAY_SR_ATR_MULT,
  INTRADAY_SR_PCT_TOL,
  INTRADAY_SL_ATR_BUFFER,
  INTRADAY_SL_ATR_FALLBACK,
  INTRADAY_REGIME_SLOPE_LOOKBACK,
  INTRADAY_MIN_CANDLES,
  INTRADAY_SR_LEVELS_MAX
} from "../../config/constants.js";

function candleTs(c) {
  const t = Number(c?.closeTime ?? c?.close_time ?? c?.openTime ?? c?.open_time ?? 0);
  return Number.isFinite(t) ? t : 0;
}

function pickNearest(levels, price, tolerance) {
  let best = null;
  let bestDist = Infinity;
  for (const lvl of levels) {
    const dist = Math.abs(price - lvl.price);
    if (dist <= tolerance && dist < bestDist) {
      best = lvl;
      bestDist = dist;
    }
  }
  return { level: best, distance: Number.isFinite(bestDist) ? bestDist : null };
}

function pickNextAbove(levels, price) {
  let best = null;
  let bestDist = Infinity;
  for (const lvl of levels) {
    if (lvl.price <= price) continue;
    const dist = lvl.price - price;
    if (dist >= 0 && dist < bestDist) {
      best = lvl;
      bestDist = dist;
    }
  }
  return best;
}

function pickNextBelow(levels, price) {
  let best = null;
  let bestDist = Infinity;
  for (const lvl of levels) {
    if (lvl.price >= price) continue;
    const dist = price - lvl.price;
    if (dist >= 0 && dist < bestDist) {
      best = lvl;
      bestDist = dist;
    }
  }
  return best;
}

function pickTopLevels(levels, currentPrice, maxCount) {
  const list = Array.isArray(levels) ? levels.slice() : [];
  list.sort((a, b) => {
    const tA = Number(b.touches || 0) - Number(a.touches || 0);
    if (tA !== 0) return tA;
    return Math.abs(Number(a.price) - currentPrice) - Math.abs(Number(b.price) - currentPrice);
  });
  return list.slice(0, maxCount);
}

export function intradaySrTradePlan({ symbol, klines, thresholds, env = {} } = {}) {
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return { ok: false, reason: "NO_SYMBOL" };

  const candles15 = klines?.getCandles?.(sym, "15m") || [];
  const candles1h = klines?.getCandles?.(sym, "1h") || [];
  const candles12h = klines?.getCandles?.(sym, "12h") || [];

  if (candles15.length < INTRADAY_MIN_CANDLES || candles1h.length < INTRADAY_MIN_CANDLES) {
    return { ok: false, reason: "INSUFFICIENT_DATA" };
  }

  const last15 = candles15[candles15.length - 1];
  const last1h = candles1h[candles1h.length - 1];

  const close15 = Number(last15?.close);
  const close1h = Number(last1h?.close);
  if (!Number.isFinite(close15) || !Number.isFinite(close1h)) return { ok: false, reason: "INVALID_PRICE" };

  const closes1h = candles1h.map((c) => Number(c.close));
  const ema13_1h = ema(closes1h, 13).at(-1);
  const ema21_1h = ema(closes1h, 21).at(-1);
  const ema50_1h = ema(closes1h, 50).at(-1);
  const ema200_1h = ema(closes1h, 200).at(-1);

  if ([ema13_1h, ema21_1h, ema50_1h, ema200_1h].some((v) => v == null || !Number.isFinite(v))) {
    return { ok: false, reason: "INDICATORS_NOT_READY" };
  }

  const longBias = close1h > ema200_1h && ema50_1h > ema200_1h && ema13_1h > ema21_1h;
  const shortBias = close1h < ema200_1h && ema50_1h < ema200_1h && ema13_1h < ema21_1h;

  if (!longBias && !shortBias) return { ok: false, reason: "NO_BIAS" };

  const direction = longBias ? "LONG" : "SHORT";

  const atr15 = atr(candles15, 14).at(-1);
  if (!Number.isFinite(atr15) || atr15 <= 0) return { ok: false, reason: "ATR_NOT_READY" };

  const { levels, tolerance } = buildSrLevels(candles15, {
    left: INTRADAY_SR_PIVOT_L,
    right: INTRADAY_SR_PIVOT_R,
    atrPeriod: 14,
    atrValue: atr15,
    close: close15,
    toleranceAtrMult: INTRADAY_SR_ATR_MULT,
    tolerancePct: INTRADAY_SR_PCT_TOL
  });

  if (!levels || !levels.length || !Number.isFinite(tolerance) || tolerance <= 0) {
    return { ok: false, reason: "NO_SR_LEVELS" };
  }

  const supports = levels.filter((l) => l.type === "S").sort((a, b) => a.price - b.price);
  const resistances = levels.filter((l) => l.type === "R").sort((a, b) => a.price - b.price);

  const entryPick = direction === "LONG"
    ? pickNearest(supports, close15, tolerance)
    : pickNearest(resistances, close15, tolerance);

  if (!entryPick.level) return { ok: false, reason: "NOT_NEAR_SR" };

  const entry = Number(entryPick.level.price);
  if (!Number.isFinite(entry)) return { ok: false, reason: "INVALID_ENTRY" };

  let sl = null;
  if (direction === "LONG") {
    const nextSupport = pickNextBelow(supports, entry);
    if (nextSupport) sl = Number(nextSupport.price) - (atr15 * INTRADAY_SL_ATR_BUFFER);
    else sl = entry - (atr15 * INTRADAY_SL_ATR_FALLBACK);
  } else {
    const nextRes = pickNextAbove(resistances, entry);
    if (nextRes) sl = Number(nextRes.price) + (atr15 * INTRADAY_SL_ATR_BUFFER);
    else sl = entry + (atr15 * INTRADAY_SL_ATR_FALLBACK);
  }

  if (!Number.isFinite(sl)) return { ok: false, reason: "INVALID_SL" };

  const tp1Level = direction === "LONG"
    ? pickNextAbove(resistances, entry)
    : pickNextBelow(supports, entry);

  if (!tp1Level) return { ok: false, reason: "NO_TP1_SR" };

  const tp1 = Number(tp1Level.price);
  if (!Number.isFinite(tp1)) return { ok: false, reason: "INVALID_TP1" };

  const risk = Math.abs(entry - sl);
  if (!Number.isFinite(risk) || risk <= 0) return { ok: false, reason: "INVALID_RISK" };

  const tp2Cap = direction === "LONG"
    ? entry + INTRADAY_RR_CAP * risk
    : entry - INTRADAY_RR_CAP * risk;

  let tp2 = tp2Cap;
  let tp2Capped = true;

  const tp2Level = direction === "LONG"
    ? pickNextAbove(resistances, tp1)
    : pickNextBelow(supports, tp1);

  if (tp2Level) {
    const rr = Math.abs(Number(tp2Level.price) - entry) / risk;
    if (Number.isFinite(rr) && rr <= INTRADAY_RR_CAP) {
      tp2 = Number(tp2Level.price);
      tp2Capped = false;
    }
  }

  const closes15 = candles15.map((c) => Number(c.close));
  const ema21_15 = ema(closes15, 21).at(-1);
  const timingOk = direction === "LONG"
    ? (Number.isFinite(ema21_15) && close15 > ema21_15)
    : (Number.isFinite(ema21_15) && close15 < ema21_15);

  const atr1h = atr(candles1h, 14).at(-1);
  const atrPct1h = Number.isFinite(atr1h) ? (atr1h / close1h) : null;

  const ema50Series = ema(closes1h, 50);
  const ema50Now = ema50Series.at(-1);
  const ema50Prev = ema50Series.at(-(INTRADAY_REGIME_SLOPE_LOOKBACK + 1));
  const ema50Slope = (Number.isFinite(ema50Now) && Number.isFinite(ema50Prev))
    ? (ema50Now - ema50Prev)
    : null;

  const closes12h = candles12h.map((c) => Number(c.close));
  const ema200_12h = closes12h.length ? ema(closes12h, 200).at(-1) : null;
  const close12h = closes12h.length ? Number(candles12h[candles12h.length - 1]?.close) : null;
  const macroBias = (Number.isFinite(close12h) && Number.isFinite(ema200_12h) && close12h > ema200_12h)
    ? "RISK_ON"
    : "RISK_OFF";
  const macroScore = macroBias === "RISK_ON" ? 100 : 0;

  const nowTs = candleTs(last15);

  const scoring = intradayScore({
    direction,
    atrPct1h,
    ema50Slope,
    srTouches: entryPick.level.touches,
    srLastTouchedTs: entryPick.level.lastTouchedTs,
    distanceToSr: entryPick.distance,
    tolerance,
    timingOk,
    macroBias,
    nowTs
  });

  const score = Number(scoring.total || 0);
  const scoreBreakdown = Object.entries(scoring.parts || {}).map(([label, value]) => ({ label, value }));

  const reasons = [];
  reasons.push(`1h EMA bias: ${direction} (close>EMA200, EMA50>EMA200, EMA13>EMA21)`);
  reasons.push(
    `Entry near ${entryPick.level.type === "S" ? "Support" : "Resistance"} ${fmtPrice(entry)} (touches=${entryPick.level.touches})`
  );
  reasons.push(
    timingOk
      ? `Timing OK: close ${direction === "LONG" ? "above" : "below"} EMA21 (15m)`
      : `Timing weak: close not ${direction === "LONG" ? "above" : "below"} EMA21 (15m)`
  );

  const macroAdj = scoring.macroAdj;
  const macroNote = `MACRO ${macroBias} (score=${macroScore}, adj=${macroAdj >= 0 ? "+" + macroAdj : macroAdj})`;
  reasons.push(macroNote);

  if (tp2Capped) reasons.push("TP2 capped by RR cap 2.00");

  const topLevels = pickTopLevels(levels, close15, INTRADAY_SR_LEVELS_MAX);

  return {
    ok: true,
    kind: "TRADE_PLAN",
    symbol: sym,
    playbook: "INTRADAY",
    tf: "15m",
    biasTf: "1h",
    direction,
    score,
    levels: { entry, sl, tp1, tp2 },
    risk,
    rr: {
      tp1: Math.abs(tp1 - entry) / risk,
      tp2: Math.abs(tp2 - entry) / risk
    },
    reasons,
    scoreBreakdown,
    macro: {
      tf: "12h",
      bias: macroBias,
      score: macroScore,
      adj: macroAdj,
      note: macroNote
    },
    srLevels: topLevels,
    tolerance,
    timingOk,
    entryLevel: entryPick.level,
    tp1Level,
    tp2Level,
    candleCloseTime: last15?.closeTime
  };
}
