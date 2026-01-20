import { ema } from "../strategy/indicators/ema.js";
import { rsi } from "../strategy/indicators/rsi.js";
import { atr } from "../strategy/indicators/atr.js";

export class Ranker {
  constructor({ klines }) {
    this.klines = klines;
  }

  fastScore(symbol, tf, thresholds) {
    const candles = this.klines.getCandles(symbol, tf);
    if (!candles || candles.length < 220) return 0;

    const closes = candles.map((c) => Number(c.close));
    const e55 = ema(closes, 55).at(-1);
    const e200 = ema(closes, 200).at(-1);
    const r14 = rsi(closes, 14).at(-1);
    const a14 = atr(candles, 14).at(-1);

    const last = candles.at(-1);
    if (e55 == null || e200 == null || r14 == null || a14 == null) return 0;

    const close = Number(last.close);
    const atrPct = a14 / close;

    // quick: prefer strong trend + acceptable volatility + RSI not weak
    let s = 0;
    if (e55 > e200) s += 40;
    else if (e55 < e200) s += 40;

    if (atrPct >= thresholds.ATR_PCT_MIN) s += 30;
    else if (atrPct >= thresholds.ATR_PCT_MIN * 0.7) s += 15;

    // RSI zone
    if (r14 >= 50 && r14 <= 70) s += 30;
    else if (r14 >= 30 && r14 < 50) s += 20;

    return s;
  }
}
