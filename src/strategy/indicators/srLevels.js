import { atr } from "./atr.js";

function candleTs(c) {
  const t = Number(c?.closeTime ?? c?.close_time ?? c?.openTime ?? c?.open_time ?? 0);
  return Number.isFinite(t) ? t : 0;
}

function detectPivots(candles, left, right) {
  const out = [];
  const len = candles.length;
  for (let i = left; i < len - right; i++) {
    const c = candles[i];
    const low = Number(c?.low);
    const high = Number(c?.high);
    if (!Number.isFinite(low) || !Number.isFinite(high)) continue;

    let isLow = true;
    let isHigh = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      const cj = candles[j];
      const lj = Number(cj?.low);
      const hj = Number(cj?.high);
      if (Number.isFinite(lj) && low >= lj) isLow = false;
      if (Number.isFinite(hj) && high <= hj) isHigh = false;
      if (!isLow && !isHigh) break;
    }

    const ts = candleTs(c);
    if (isLow) out.push({ type: "S", price: low, touches: 1, lastTouchedTs: ts });
    if (isHigh) out.push({ type: "R", price: high, touches: 1, lastTouchedTs: ts });
  }
  return out;
}

function clusterLevels(levels, tolerance) {
  if (!levels.length) return [];
  const tol = Number(tolerance);
  const out = [];
  for (const lvl of levels) {
    const last = out[out.length - 1];
    if (last && Math.abs(lvl.price - last.price) <= tol) {
      const touches = Number(last.touches || 0) + 1;
      last.price = (Number(last.price) * (touches - 1) + Number(lvl.price)) / touches;
      last.touches = touches;
      last.lastTouchedTs = Math.max(Number(last.lastTouchedTs || 0), Number(lvl.lastTouchedTs || 0));
    } else {
      out.push({ ...lvl });
    }
  }
  return out;
}

export function buildSrLevels(candles, opts = {}) {
  if (!Array.isArray(candles) || candles.length < 10) return { levels: [], tolerance: null };

  const left = Math.max(1, Number(opts.left ?? 3));
  const right = Math.max(1, Number(opts.right ?? 3));

  const last = candles[candles.length - 1];
  const close = Number(opts.close ?? last?.close);

  let atrVal = Number(opts.atrValue);
  if (!Number.isFinite(atrVal)) {
    const atrArr = atr(candles, Number(opts.atrPeriod ?? 14));
    atrVal = Number(atrArr[atrArr.length - 1]);
  }

  const atrMult = Number(opts.toleranceAtrMult ?? 0.25);
  const pctTol = Number(opts.tolerancePct ?? 0.002);
  const tol = Number.isFinite(opts.tolerance)
    ? Number(opts.tolerance)
    : Math.max((Number.isFinite(atrVal) ? atrVal * atrMult : 0), (Number.isFinite(close) ? close * pctTol : 0));

  if (!Number.isFinite(tol) || tol <= 0) return { levels: [], tolerance: null };

  const pivots = detectPivots(candles, left, right);
  const supports = pivots.filter((p) => p.type === "S").sort((a, b) => a.price - b.price);
  const resistances = pivots.filter((p) => p.type === "R").sort((a, b) => a.price - b.price);

  const clustered = [
    ...clusterLevels(supports, tol),
    ...clusterLevels(resistances, tol)
  ].sort((a, b) => a.price - b.price);

  return { levels: clustered, tolerance: tol };
}
