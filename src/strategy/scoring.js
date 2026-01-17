import { clamp } from "../config/constants.js";
import { ENV } from "../config/env.js";
import { macdHistogram } from "../indicators/macd.js";
import { volumeRatio } from "../indicators/volume.js";
import { fvgScoreBundle } from "./fvg.js";

export function baseScore({ ind, candles }) {
  const last = candles[candles.length - 1];
  const { emaMid, emaSlow, rsi, adx, atr, atrPct, emaFast } = ind;

  // H1) Trend strength (|EMA55-EMA200| / ATR): 0–30
  const trendRaw = atr > 0 ? Math.abs(emaMid - emaSlow) / atr : 0;
  const trend = clamp(trendRaw * 10, 0, 30);

  // Momentum (|RSI−50|): 0–25
  const mom = clamp(Math.abs(rsi - 50) * 1.0, 0, 25);

  // ADX: 0–25
  const adxScore = clamp((adx / 50) * 25, 0, 25);

  // ATR%: 0–10 (atrPct in %)
  const atrScore = clamp(((atrPct - ENV.ATR_PCT_MIN) / 1.0) * 10, 0, 10);

  // Pullback quality (touch EMA21): 0–10
  const touch = (last.low <= emaFast && last.close > emaFast) || (last.high >= emaFast && last.close < emaFast);
  const pullback = touch ? 10 : 0;

  const total = trend + mom + adxScore + atrScore + pullback;
  return {
    score: clamp(total, 0, 100),
    factors: {
      trend: Math.round(trend),
      rsi: Math.round(mom),
      adx: Math.round(adxScore),
      atr: Math.round(atrScore),
      pullback: Math.round(pullback),
    },
  };
}

export function advancedScores({ candles, entryMid, atr, direction }) {
  // FVG: 0..18
  const fvg = fvgScoreBundle({ candles, entryMid, atr });

  // MACD hist: 0..15
  const closes = candles.map((c) => c.close);
  const macd = macdHistogram(closes, 12, 26, 9);
  let macdScore = 0;
  let macdAligned = false;
  let macdStrength = false;

  if (macd) {
    macdAligned = direction === "LONG" ? macd.hist > 0 : macd.hist < 0;
    if (macdAligned) macdScore += 10;

    // histogram strengthening in direction: LONG delta>0, SHORT delta<0
    macdStrength = direction === "LONG" ? macd.delta > 0 : macd.delta < 0;
    if (macdStrength) macdScore += 5;
  }

  // Volume ratio: 0..10
  const vr = volumeRatio(candles, 20);
  let volScore = 0;
  if (vr != null) {
    if (vr >= 1.2) volScore = 10;
    else if (vr >= 1.0) volScore = 5;
  }

  return {
    fvg,
    macd: macd ? { ...macd, aligned: macdAligned, strengthening: macdStrength, score: macdScore } : null,
    volRatio: vr,
    score: clamp(fvg.score + macdScore + volScore, 0, 100),
    factorScores: {
      fvg: fvg.score,
      macd: macdScore,
      volume: volScore,
    },
  };
}

export function finalScore({ base, adv, macroAdj }) {
  const total = base.score + adv.score + macroAdj;
  return clamp(total, 0, 100);
}
