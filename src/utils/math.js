export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
export function pct(a, b) {
  const x = Number(a), y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || y === 0) return 0;
  return x / y;
}
export function round(n, d = 2) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  const p = 10 ** d;
  return Math.round(x * p) / p;
}
