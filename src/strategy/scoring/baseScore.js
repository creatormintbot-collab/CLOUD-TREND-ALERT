import { clamp } from "../../utils/math.js";

export function baseScore(ctx) {
  const { direction, ema55, ema200, ema21, close, atr, rsi, adx, atrPct, thresholds } = ctx;

  let emaPts = 0;
  if (ema55 != null && ema200 != null) {
    const trendOk = direction === "LONG" ? ema55 > ema200 : ema55 < ema200;
    emaPts = trendOk ? 30 : 0;
  }

  let pbPts = 0;
  if (ema21 != null && atr != null) {
    const dist = Math.abs(close - ema21);
    const q = dist / (atr || 1e-9);
    // pullback ideal: close near ema21 (<= 0.6 ATR)
    pbPts = q <= 0.6 ? 25 : q <= 1.0 ? 15 : 5;
  }

  let rsiPts = 0;
  if (rsi != null) {
    if (direction === "LONG") rsiPts = rsi >= thresholds.RSI_BULL_MIN ? 15 : rsi >= 50 ? 8 : 0;
    else rsiPts = rsi <= thresholds.RSI_BEAR_MAX ? 15 : rsi <= 50 ? 8 : 0;
  }

  let adxPts = 0;
  if (adx != null) adxPts = adx >= thresholds.ADX_MIN ? 20 : adx >= (thresholds.ADX_MIN - 4) ? 10 : 0;

  let riskPts = 0;
  if (atrPct != null) riskPts = atrPct >= thresholds.ATR_PCT_MIN ? 10 : atrPct >= thresholds.ATR_PCT_MIN * 0.7 ? 5 : 0;

  const total = clamp(emaPts + pbPts + rsiPts + adxPts + riskPts, 0, 100);

  return { total, parts: { EMA: emaPts, PULLBACK: pbPts, RSI: rsiPts, ADX: adxPts, RISK: riskPts } };
}
