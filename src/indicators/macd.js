import { emaSeries } from "./ema.js";

export function macdHistogram(closes, fast = 12, slow = 26, signal = 9) {
  if (!closes || closes.length < slow + signal + 5) return null;

  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);

  const macdLine = emaFast.map((v, i) => v - (emaSlow[i] ?? 0));
  const signalLine = emaSeries(macdLine, signal);
  const hist = macdLine.map((v, i) => v - (signalLine[i] ?? 0));

  const last = hist[hist.length - 1];
  const prev = hist[hist.length - 2] ?? 0;
  return { hist: last, prevHist: prev, delta: last - prev };
}
