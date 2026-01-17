import { ema } from "../indicators/ema.js";
import { rsi } from "../indicators/rsi.js";
import { atr } from "../indicators/atr.js";
import { adx } from "../indicators/adx.js";

export function evaluateEntryLocked({ candles, env }) {
  // returns { ok, direction, reason[], indicators } with LOCKED rules
  if (candles.length < 300) {
    return { ok: false, reason: ["Not enough candles (<300)"] };
  }

  const closes = candles.map((c) => c.close);
  const last = candles[candles.length - 1];

  const ema21 = ema(closes, 21);
  const ema55 = ema(closes, 55);
  const ema200 = ema(closes, 200);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(candles, 14);
  const adx14 = adx(candles, 14);

  if ([ema21, ema55, ema200, rsi14, atr14, adx14].some((x) => x == null)) {
    return { ok: false, reason: ["Indicator not ready"] };
  }

  const atrPct = (atr14 / last.close) * 100;

  const reasons = [];
  if (adx14 < env.ADX_MIN) reasons.push(`ADX < ${env.ADX_MIN}`);
  if (atrPct < env.ATR_PCT_MIN) reasons.push(`ATR% < ${env.ATR_PCT_MIN}`);

  const longOk =
    ema55 > ema200 &&
    rsi14 >= env.RSI_BULL_MIN &&
    last.close > ema21 &&
    last.low <= ema21 &&
    adx14 >= env.ADX_MIN &&
    atrPct >= env.ATR_PCT_MIN;

  const shortOk =
    ema55 < ema200 &&
    rsi14 <= env.RSI_BEAR_MAX &&
    last.close < ema21 &&
    last.high >= ema21 &&
    adx14 >= env.ADX_MIN &&
    atrPct >= env.ATR_PCT_MIN;

  if (!longOk && !shortOk) {
    return {
      ok: false,
      reason: reasons.length ? reasons : ["Entry rules not satisfied"],
      indicators: { ema21, ema55, ema200, rsi14, atr14, adx14, atrPct }
    };
  }

  return {
    ok: true,
    direction: longOk ? "LONG" : "SHORT",
    reason: [],
    indicators: { ema21, ema55, ema200, rsi14, atr14, adx14, atrPct }
  };
}
