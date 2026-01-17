export function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values[values.length - period]; // seed
  for (let i = values.length - period + 1; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
  }
  return e;
}
