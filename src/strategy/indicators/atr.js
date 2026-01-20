export function atr(candles, period = 14) {
  const p = Number(period);
  const out = new Array(candles.length).fill(null);
  if (candles.length < p + 1) return out;

  const tr = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const h = Number(candles[i].high);
    const l = Number(candles[i].low);
    const pc = Number(candles[i - 1].close);
    const a = h - l;
    const b = Math.abs(h - pc);
    const c = Math.abs(l - pc);
    tr[i] = Math.max(a, b, c);
  }

  let sum = 0;
  for (let i = 1; i <= p; i++) sum += tr[i];
  out[p] = sum / p;

  for (let i = p + 1; i < candles.length; i++) {
    out[i] = (out[i - 1] * (p - 1) + tr[i]) / p;
  }
  return out;
}
