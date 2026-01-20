import { round } from "./math.js";

export function fmtPrice(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "0";
  if (n >= 1000) return n.toFixed(2);
  if (n >= 100) return n.toFixed(3);
  return n.toFixed(4);
}

export function fmtSignedInt(n) {
  const x = Math.round(Number(n) || 0);
  return (x >= 0 ? `+${x}` : `${x}`);
}

export function fmtScore(n) {
  return Math.round(Number(n) || 0);
}

export function fmtPct(n) {
  return `${round(Number(n) * 100, 2)}%`;
}
