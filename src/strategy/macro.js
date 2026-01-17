import { computeCoreIndicators } from "./intradayPro.js";

export function macroBTCTrend(btcCandles) {
  const ind = computeCoreIndicators(btcCandles);
  if (!Number.isFinite(ind.emaMid) || !Number.isFinite(ind.emaSlow) || !Number.isFinite(ind.rsi)) return "FLAT";

  if (ind.emaMid > ind.emaSlow && ind.rsi > 50) return "UP";
  if (ind.emaMid < ind.emaSlow && ind.rsi < 50) return "DOWN";
  return "FLAT";
}

export function macroAltStrength(altCandlesBySymbol) {
  // ALT UP if avg slope EMA55 (last - prev) > 0
  const slopes = [];
  for (const candles of altCandlesBySymbol) {
    const indNow = computeCoreIndicators(candles);
    // approximate slope by comparing last close vs emaMid (55) distance sign
    // plus: last two emaMid using slightly shifted candles
    if (!Number.isFinite(indNow.emaMid)) continue;

    const candlesPrev = candles.slice(0, -1);
    const indPrev = computeCoreIndicators(candlesPrev);
    if (!Number.isFinite(indPrev.emaMid)) continue;

    slopes.push(indNow.emaMid - indPrev.emaMid);
  }
  if (!slopes.length) return "FLAT";
  const avg = slopes.reduce((a, b) => a + b, 0) / slopes.length;
  const eps = Math.abs(avg) < 1e-9 ? 0 : avg;

  if (eps > 0) return "UP";
  if (eps < 0) return "DOWN";
  return "FLAT";
}

export function macroBias({ btcTrend, altStrength }) {
  if (btcTrend === "UP" && altStrength === "UP") return "RISK_ON";
  if (btcTrend === "DOWN" || altStrength === "DOWN") return "RISK_OFF";
  return "NEUTRAL";
}

export function macroAdj({ bias, direction }) {
  if (bias === "NEUTRAL") return 0;
  if (bias === "RISK_ON" && direction === "LONG") return +8;
  if (bias === "RISK_OFF" && direction === "SHORT") return +8;
  // contradiction
  return -8;
}
