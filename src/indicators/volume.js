export function sma(values, length) {
  if (!values || values.length < length) return null;
  const slice = values.slice(values.length - length);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / length;
}

export function volumeRatio(candles, length = 20) {
  if (!candles || candles.length < length + 1) return null;
  const vols = candles.map((c) => c.volume);
  const cur = vols[vols.length - 1];
  const avg = sma(vols.slice(0, -1), length);
  if (!avg || avg === 0) return null;
  return cur / avg;
}
