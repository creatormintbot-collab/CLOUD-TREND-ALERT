export function sma(values, period) {
  const p = Number(period);
  if (!Array.isArray(values) || p < 2) return [];
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += Number(values[i]);
    if (i >= p) sum -= Number(values[i - p]);
    if (i >= p - 1) out[i] = sum / p;
  }
  return out;
}
