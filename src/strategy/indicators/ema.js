export function ema(values, period) {
  const p = Number(period);
  if (!Array.isArray(values) || values.length === 0 || p < 2) return [];
  const k = 2 / (p + 1);
  const out = new Array(values.length).fill(null);
  let prev = Number(values[0]);
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    const v = Number(values[i]);
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
