import { ema } from "./ema.js";

export function macdHistogram(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal + 5) return null;

  // build MACD series last ~ (signal+5) points
  const macdSeries = [];
  for (let i = slow; i <= closes.length; i++) {
    const slice = closes.slice(0, i);
    const eFast = ema(slice, fast);
    const eSlow = ema(slice, slow);
    if (eFast == null || eSlow == null) continue;
    macdSeries.push(eFast - eSlow);
  }

  if (macdSeries.length < signal + 3) return null;
  const sig = ema(macdSeries, signal);
  if (sig == null) return null;

  const lastMacd = macdSeries[macdSeries.length - 1];
  const hist = lastMacd - sig;

  // strengthening: compare last 3 hist values
  const h2 = macdSeries[macdSeries.length - 2] - ema(macdSeries.slice(0, -1), signal);
  const h3 = macdSeries[macdSeries.length - 3] - ema(macdSeries.slice(0, -2), signal);

  return { hist, prevHist: h2 ?? 0, prev2Hist: h3 ?? 0 };
}
