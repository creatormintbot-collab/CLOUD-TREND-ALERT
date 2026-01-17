import { ema } from "../indicators/ema.js";
import { rsi } from "../indicators/rsi.js";
import { atr } from "../indicators/atr.js";
import { adx } from "../indicators/adx.js";
import { ENV } from "../config/env.js";

export function computeCoreIndicators(candles) {
  const closes = candles.map((c) => c.close);

  const emaFast = ema(closes, ENV.EMA_FAST);
  const emaMid = ema(closes, ENV.EMA_MID);
  const emaSlow = ema(closes, ENV.EMA_SLOW);

  const r = rsi(closes, ENV.RSI_LEN);
  const a = atr(candles, ENV.ATR_LEN);
  const d = adx(candles, ENV.ADX_LEN);

  const last = candles[candles.length - 1];
  const atrPct = a && last?.close ? (a / last.close) * 100 : null;

  return { emaFast, emaMid, emaSlow, rsi: r, atr: a, adx: d, atrPct };
}

export function entryRule({ candles, ind }) {
  const last = candles[candles.length - 1];
  if (!last) return { ok: false, reason: "no candle" };

  const { emaFast, emaMid, emaSlow, rsi, adx, atrPct } = ind;

  if (![emaFast, emaMid, emaSlow, rsi, adx, atrPct].every(Number.isFinite)) {
    return { ok: false, reason: "indicator not ready" };
  }
  if (adx < ENV.ADX_MIN) return { ok: false, reason: "ADX too low" };
  if (atrPct < ENV.ATR_PCT_MIN) return { ok: false, reason: "ATR% too low" };

  // Pullback rule (touch EMA fast)
  const touchLong = last.low <= emaFast && last.close > emaFast;
  const touchShort = last.high >= emaFast && last.close < emaFast;

  const longOk =
    emaMid > emaSlow &&
    rsi >= 52 &&
    touchLong;

  const shortOk =
    emaMid < emaSlow &&
    rsi <= 48 &&
    touchShort;

  if (longOk) return { ok: true, direction: "LONG" };
  if (shortOk) return { ok: true, direction: "SHORT" };

  return { ok: false, reason: "entry rule not met" };
}
