import { ema } from "../indicators/ema.js";
import { rsi } from "../indicators/rsi.js";

export function macroContextProxy({ btc4h, altBasket4h }) {
  // proxy: BTC trend (EMA55/200 + RSI)
  // ALT strength: basket EMA slope (simple: last close vs EMA55)
  const ctx = {
    btc: "NEUTRAL",
    alt: "NEUTRAL",
    bias: "NEUTRAL"
  };

  const evalTrend = (candles) => {
    if (!candles || candles.length < 220) return "NEUTRAL";
    const closes = candles.map((c) => c.close);
    const e55 = ema(closes, 55);
    const e200 = ema(closes, 200);
    const r14 = rsi(closes, 14);
    if ([e55, e200, r14].some((x) => x == null)) return "NEUTRAL";
    if (e55 > e200 && r14 >= 52) return "UP";
    if (e55 < e200 && r14 <= 48) return "DOWN";
    return "NEUTRAL";
  };

  const evalAlt = (candles) => {
    if (!candles || candles.length < 60) return "NEUTRAL";
    const closes = candles.map((c) => c.close);
    const e55 = ema(closes, 55);
    const last = closes[closes.length - 1];
    if (e55 == null) return "NEUTRAL";
    if (last > e55) return "UP";
    if (last < e55) return "DOWN";
    return "NEUTRAL";
  };

  ctx.btc = evalTrend(btc4h);
  ctx.alt = evalAlt(altBasket4h);

  if (ctx.btc === "UP" && ctx.alt === "UP") ctx.bias = "RISK_ON";
  else if (ctx.btc === "DOWN" && ctx.alt === "DOWN") ctx.bias = "RISK_OFF";
  else ctx.bias = "NEUTRAL";

  return ctx;
}

export function scoreMacro({ bias, direction }) {
  // align +8, kontra -8
  if (!bias || bias === "NEUTRAL") return 0;
  const wantRiskOn = direction === "LONG";
  if (bias === "RISK_ON") return wantRiskOn ? 8 : -8;
  if (bias === "RISK_OFF") return wantRiskOn ? -8 : 8;
  return 0;
}
