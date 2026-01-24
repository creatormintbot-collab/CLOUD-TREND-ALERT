import { ema } from "./ema.js";

export function macd(values, fast = 12, slow = 26, signal = 9) {
  const eFast = ema(values, fast);
  const eSlow = ema(values, slow);

  const macdLine = values.map((_, i) =>
    (eFast[i] == null || eSlow[i] == null) ? null : (eFast[i] - eSlow[i])
  );

  // IMPORTANT: do NOT zero-fill nulls into the signal EMA.
  // Zero-filling makes early MACD signal/hist look "ready" and can cause premature flips on LTF.
  const signalLine = new Array(values.length).fill(null);
  const start = macdLine.findIndex((v) => v != null);
  if (start >= 0) {
    const slice = macdLine.slice(start).map((v) => Number(v));
    const sig = ema(slice, signal);
    for (let i = start; i < values.length; i++) {
      signalLine[i] = sig[i - start];
    }
  }

  const hist = macdLine.map((v, i) =>
    (v == null || signalLine[i] == null) ? null : (v - signalLine[i])
  );

  return { macdLine, signalLine, hist };
}
