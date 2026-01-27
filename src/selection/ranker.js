import { ema } from "../strategy/indicators/ema.js";
import { rsi } from "../strategy/indicators/rsi.js";
import { atr } from "../strategy/indicators/atr.js";

function normTf(tf) {
  return String(tf || "").trim().toLowerCase();
}

function intradayBiasTf(signalTf) {
  return normTf(signalTf) === "1h" ? "4h" : "1h";
}

export class Ranker {
  constructor({ klines }) {
    this.klines = klines;
  }

  fastScoreIntraday(symbol, signalTf, thresholds) {
    let tf = signalTf;
    let thr = thresholds;
    if (thr === undefined && signalTf && typeof signalTf === "object") {
      thr = signalTf;
      tf = "15m";
    }

    const biasTf = intradayBiasTf(tf);
    const candles = this.klines.getCandles(symbol, biasTf);
    if (!candles || candles.length < 220) return 0;

    const closes = candles.map((c) => Number(c.close));
    const e13 = ema(closes, 13).at(-1);
    const e21 = ema(closes, 21).at(-1);
    const e50 = ema(closes, 50).at(-1);
    const e200 = ema(closes, 200).at(-1);
    const a14 = atr(candles, 14).at(-1);

    const last = candles.at(-1);
    if (e13 == null || e21 == null || e50 == null || e200 == null || a14 == null) return 0;

    const close = Number(last.close);
    const atrPct = a14 / close;

    const longBias = close > e200 && e50 > e200 && e13 > e21;
    const shortBias = close < e200 && e50 < e200 && e13 < e21;
    if (!longBias && !shortBias) return 0;

    let s = 60; // bias gate

    const atrMin = Number(thr?.ATR_PCT_MIN ?? 0);
    if (atrPct >= atrMin) s += 20;
    else if (atrPct >= atrMin * 0.7) s += 10;

    const ema50Series = ema(closes, 50);
    const prev = ema50Series.at(-6);
    const slope = (Number.isFinite(prev) && Number.isFinite(e50)) ? (e50 - prev) : 0;
    if ((longBias && slope > 0) || (shortBias && slope < 0)) s += 20;

    return s;
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
