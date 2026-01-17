export function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;

  let sumTR = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
    sumTR += tr;
  }
  return sumTR / period;
}
