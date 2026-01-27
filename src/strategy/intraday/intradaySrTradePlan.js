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
  INTRADAY_SL_ATR_MULT,
  INTRADAY_SL_FALLBACK_ATR_MULT,
  INTRADAY_MIN_RISK_PCT,
  INTRADAY_TP1_MIN_RR,
  INTRADAY_MIN_GAP_ATR_MULT,
  INTRADAY_MIN_GAP_PCT,
  INTRADAY_REGIME_SLOPE_LOOKBACK,
  INTRADAY_MIN_CANDLES,
  INTRADAY_SR_LEVELS_MAX
} from "../../config/constants.js";

function candleTs(c) {
  const t = Number(c?.closeTime ?? c?.close_time ?? c?.openTime ?? c?.open_time ?? 0);
  return Number.isFinite(t) ? t : 0;
}

function normTf(tf) {
  return String(tf || "").trim().toLowerCase();
}

function biasTfForSignal(tf) {
  return normTf(tf) === "1h" ? "4h" : "1h";
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

function pickNextAboveWithGap(levels, price, minGap) {
  const gap = Number(minGap);
  for (const lvl of levels) {
    if (lvl.price <= price) continue;
    const dist = lvl.price - price;
    if (!Number.isFinite(gap) || gap <= 0 || dist >= gap) return lvl;
  }
  return null;
}

function pickNextBelowWithGap(levels, price, minGap) {
  const gap = Number(minGap);
  for (let i = levels.length - 1; i >= 0; i--) {
    const lvl = levels[i];
    if (lvl.price >= price) continue;
    const dist = price - lvl.price;
    if (!Number.isFinite(gap) || gap <= 0 || dist >= gap) return lvl;
  }
  return null;
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

export function intradaySrTradePlan({ symbol, tf, klines, thresholds, env = {} } = {}) {
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return { ok: false, reason: "NO_SYMBOL" };

  const signalTf = normTf(tf || "15m");
  const biasTf = biasTfForSignal(signalTf);

  const candlesSignal = klines?.getCandles?.(sym, signalTf) || [];
  const candlesBias = klines?.getCandles?.(sym, biasTf) || [];
  const candles12h = klines?.getCandles?.(sym, "12h") || [];

  if (candlesSignal.length < INTRADAY_MIN_CANDLES || candlesBias.length < INTRADAY_MIN_CANDLES) {
    return { ok: false, reason: "INSUFFICIENT_DATA" };
  }

  const lastSignal = candlesSignal[candlesSignal.length - 1];
  const lastBias = candlesBias[candlesBias.length - 1];

  const closeSignal = Number(lastSignal?.close);
  const closeBias = Number(lastBias?.close);
  if (!Number.isFinite(closeSignal) || !Number.isFinite(closeBias)) return { ok: false, reason: "INVALID_PRICE" };

  const closesBias = candlesBias.map((c) => Number(c.close));
  const ema13_bias = ema(closesBias, 13).at(-1);
  const ema21_bias = ema(closesBias, 21).at(-1);
  const ema50_bias = ema(closesBias, 50).at(-1);
  const ema200_bias = ema(closesBias, 200).at(-1);

  if ([ema13_bias, ema21_bias, ema50_bias, ema200_bias].some((v) => v == null || !Number.isFinite(v))) {
    return { ok: false, reason: "INDICATORS_NOT_READY" };
  }

  const longBias = closeBias > ema200_bias && ema50_bias > ema200_bias && ema13_bias > ema21_bias;
  const shortBias = closeBias < ema200_bias && ema50_bias < ema200_bias && ema13_bias < ema21_bias;

  if (!longBias && !shortBias) return { ok: false, reason: "NO_BIAS" };

  const direction = longBias ? "LONG" : "SHORT";

  const atrSignal = atr(candlesSignal, 14).at(-1);
  if (!Number.isFinite(atrSignal) || atrSignal <= 0) return { ok: false, reason: "ATR_NOT_READY" };

  const { levels, tolerance } = buildSrLevels(candlesSignal, {
    left: INTRADAY_SR_PIVOT_L,
    right: INTRADAY_SR_PIVOT_R,
    atrPeriod: 14,
    atrValue: atrSignal,
    close: closeSignal,
    toleranceAtrMult: INTRADAY_SR_ATR_MULT,
    tolerancePct: INTRADAY_SR_PCT_TOL
  });

  if (!levels || !levels.length || !Number.isFinite(tolerance) || tolerance <= 0) {
    return { ok: false, reason: "NO_SR_LEVELS" };
  }

  const supports = levels.filter((l) => l.type === "S").sort((a, b) => a.price - b.price);
  const resistances = levels.filter((l) => l.type === "R").sort((a, b) => a.price - b.price);

  const entryPick = direction === "LONG"
    ? pickNearest(supports, closeSignal, tolerance)
    : pickNearest(resistances, closeSignal, tolerance);

  if (!entryPick.level) return { ok: false, reason: "NOT_NEAR_SR" };

  const entry = Number(entryPick.level.price);
  if (!Number.isFinite(entry)) return { ok: false, reason: "INVALID_ENTRY" };

  const minGap = Math.max(
    INTRADAY_MIN_GAP_ATR_MULT * atrSignal,
    (INTRADAY_MIN_GAP_PCT / 100) * closeSignal
  );
  const internalNotes = [];

  let sl = null;
  if (direction === "LONG") {
    const nextSupport = pickNextBelow(supports, entry);
    if (nextSupport) sl = Number(nextSupport.price) - (atrSignal * INTRADAY_SL_ATR_MULT);
    else sl = entry - (atrSignal * INTRADAY_SL_FALLBACK_ATR_MULT);
  } else {
    const nextRes = pickNextAbove(resistances, entry);
    if (nextRes) sl = Number(nextRes.price) + (atrSignal * INTRADAY_SL_ATR_MULT);
    else sl = entry + (atrSignal * INTRADAY_SL_FALLBACK_ATR_MULT);
  }

  if (!Number.isFinite(sl)) return { ok: false, reason: "INVALID_SL" };

  let risk = Math.abs(entry - sl);
  if (!Number.isFinite(risk) || risk <= 0) return { ok: false, reason: "INVALID_RISK" };

  const minRisk = entry * (INTRADAY_MIN_RISK_PCT / 100);
  if (Number.isFinite(minRisk) && minRisk > 0 && risk < minRisk) {
    sl = direction === "LONG" ? (entry - minRisk) : (entry + minRisk);
    risk = Math.abs(entry - sl);
  }

  const tp1Level = direction === "LONG"
    ? pickNextAbove(resistances, entry)
    : pickNextBelow(supports, entry);

  if (!tp1Level) return { ok: false, reason: "NO_TP1_SR" };

  let tp1 = Number(tp1Level.price);
  if (!Number.isFinite(tp1)) return { ok: false, reason: "INVALID_TP1" };

  const baseRRTarget = direction === "LONG"
    ? entry + (INTRADAY_TP1_MIN_RR * risk)
    : entry - (INTRADAY_TP1_MIN_RR * risk);

  if (direction === "LONG") tp1 = Math.max(tp1, baseRRTarget);
  else tp1 = Math.min(tp1, baseRRTarget);

  if (Number.isFinite(minGap) && minGap > 0 && Math.abs(tp1 - entry) < minGap) {
    tp1 = direction === "LONG" ? (entry + minGap) : (entry - minGap);
  }

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

  if (Number.isFinite(minGap) && minGap > 0) {
    const gap12 = Math.abs(tp2 - tp1);
    if (gap12 < minGap) {
      const desired = direction === "LONG" ? (tp1 + minGap) : (tp1 - minGap);
      const withinCap = direction === "LONG" ? desired <= tp2Cap : desired >= tp2Cap;
      if (withinCap) {
        tp2 = desired;
      } else {
        internalNotes.push("TP2 minGap blocked by RR cap");
      }
    }
  }

  let tp3 = tp2;
  const tp3Level = direction === "LONG"
    ? pickNextAboveWithGap(resistances, tp2, minGap)
    : pickNextBelowWithGap(supports, tp2, minGap);

  let tp3FromLevel = null;
  if (tp3Level) {
    const lvlPrice = Number(tp3Level.price);
    if (Number.isFinite(lvlPrice)) tp3FromLevel = lvlPrice;
  }

  if (tp3FromLevel !== null) {
    tp3 = tp3FromLevel;
  } else {
    const tp3R = direction === "LONG"
      ? entry + (2.5 * risk)
      : entry - (2.5 * risk);
    if (Number.isFinite(tp3R) && (!Number.isFinite(minGap) || Math.abs(tp3R - tp2) >= minGap)) {
      tp3 = tp3R;
    } else {
      tp3 = tp2;
      internalNotes.push("TP3 fallback to TP2 (minGap unmet)");
    }
  }

  if (direction === "LONG") {
    if (tp1 > tp2) {
      internalNotes.push("TP1 adjusted to preserve ordering");
      tp1 = tp2;
    }
    if (tp3 < tp2) {
      internalNotes.push("TP3 adjusted to preserve ordering");
      tp3 = tp2;
    }
  } else {
    if (tp1 < tp2) {
      internalNotes.push("TP1 adjusted to preserve ordering");
      tp1 = tp2;
    }
    if (tp3 > tp2) {
      internalNotes.push("TP3 adjusted to preserve ordering");
      tp3 = tp2;
    }
  }

  const closesSignal = candlesSignal.map((c) => Number(c.close));
  const ema21_signal = ema(closesSignal, 21).at(-1);
  const timingOk = direction === "LONG"
    ? (Number.isFinite(ema21_signal) && closeSignal > ema21_signal)
    : (Number.isFinite(ema21_signal) && closeSignal < ema21_signal);

  const atrBias = atr(candlesBias, 14).at(-1);
  const atrPct1h = Number.isFinite(atrBias) ? (atrBias / closeBias) : null;

  const ema50Series = ema(closesBias, 50);
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

  const nowTs = candleTs(lastSignal);

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
  reasons.push(`${biasTf} EMA bias: ${direction} (close>EMA200, EMA50>EMA200, EMA13>EMA21)`);
  reasons.push(
    `Entry near ${entryPick.level.type === "S" ? "Support" : "Resistance"} ${fmtPrice(entry)} (touches=${entryPick.level.touches})`
  );
  reasons.push(
    timingOk
      ? `Timing OK: close ${direction === "LONG" ? "above" : "below"} EMA21 (${signalTf})`
      : `Timing weak: close not ${direction === "LONG" ? "above" : "below"} EMA21 (${signalTf})`
  );

  const macroAdj = scoring.macroAdj;
  const macroNote = `MACRO ${macroBias} (score=${macroScore}, adj=${macroAdj >= 0 ? "+" + macroAdj : macroAdj})`;
  reasons.push(macroNote);

  if (tp2Capped) reasons.push("TP2 capped by RR cap 2.00");

  const topLevels = pickTopLevels(levels, closeSignal, INTRADAY_SR_LEVELS_MAX);

  return {
    ok: true,
    kind: "TRADE_PLAN",
    symbol: sym,
    playbook: "INTRADAY",
    tf: signalTf,
    biasTf,
    direction,
    score,
    levels: { entry, sl, tp1, tp2, tp3 },
    risk,
    rr: {
      tp1: Math.abs(tp1 - entry) / risk,
      tp2: Math.abs(tp2 - entry) / risk,
      tp3: Math.abs(tp3 - entry) / risk
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
    candles: candlesSignal,
    candleCloseTime: lastSignal?.closeTime,
    internalNotes
  };
}
