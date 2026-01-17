export function atr(candles, length = 14) {
  if (!candles || candles.length < length + 1) return null;

  let sumTR = 0;
  for (let i = candles.length - length; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
    sumTR += tr;
  }
  return sumTR / length;
}
