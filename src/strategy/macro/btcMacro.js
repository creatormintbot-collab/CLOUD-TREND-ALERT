import { ema } from "../indicators/ema.js";
import { rsi } from "../indicators/rsi.js";

export function btcMacro({ klines, rsiBull = 52, rsiBear = 48 } = {}) {
  const candles = klines.getCandles("BTCUSDT", "4h");
  if (!candles.length) {
    return { BTC_STATE: "NEUTRAL", ALT_STATE: "NEUTRAL", BIAS: "NEUTRAL", MACRO_PTS: 0 };
  }

  const closes = candles.map((c) => Number(c.close));
  const e55 = ema(closes, 55);
  const e200 = ema(closes, 200);
  const r = rsi(closes, 14);

  const i = closes.length - 1;
  const ema55 = e55[i], ema200 = e200[i], rr = r[i];

  let BTC_STATE = "NEUTRAL";
  if (ema55 != null && ema200 != null && rr != null) {
    if (ema55 > ema200 && rr >= rsiBull) BTC_STATE = "BULLISH";
    else if (ema55 < ema200 && rr <= rsiBear) BTC_STATE = "BEARISH";
  }

  const BIAS = BTC_STATE === "BULLISH" ? "RISK_ON" : BTC_STATE === "BEARISH" ? "RISK_OFF" : "NEUTRAL";
  const ALT_STATE = "FOLLOW_BTC";

  return { BTC_STATE, ALT_STATE, BIAS, MACRO_PTS: 0 };
}
