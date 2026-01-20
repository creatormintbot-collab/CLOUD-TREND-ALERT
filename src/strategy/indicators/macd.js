import { ema } from "./ema.js";

export function macd(values, fast = 12, slow = 26, signal = 9) {
  const eFast = ema(values, fast);
  const eSlow = ema(values, slow);
  const macdLine = values.map((_, i) => (eFast[i] == null || eSlow[i] == null) ? null : (eFast[i] - eSlow[i]));
  const signalLine = ema(macdLine.map((x) => x ?? 0), signal);
  const hist = macdLine.map((v, i) => (v == null || signalLine[i] == null) ? null : (v - signalLine[i]));
  return { macdLine, signalLine, hist };
}
