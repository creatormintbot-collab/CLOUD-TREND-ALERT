function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normTf(tf) {
  return String(tf || "").trim().toLowerCase();
}

function playbookForTf(tf) {
  return normTf(tf) === "4h" ? "SWING" : "INTRADAY";
}

function pivotCandidates(candles, pivotLen = 4) {
  const out = [];
  const n = Array.isArray(candles) ? candles.length : 0;
  if (n < pivotLen * 2 + 5) return out;

  for (let i = pivotLen; i < n - pivotLen; i++) {
    const hi = toNum(candles[i]?.high);
    const lo = toNum(candles[i]?.low);
    if (hi == null || lo == null) continue;

    let isHigh = true;
    let isLow = true;
    for (let j = i - pivotLen; j <= i + pivotLen; j++) {
      if (j === i) continue;
      const hj = toNum(candles[j]?.high);
      const lj = toNum(candles[j]?.low);
      if (hj != null && hj > hi) isHigh = false;
      if (lj != null && lj < lo) isLow = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) out.push({ idx: i, price: hi, type: "H" });
    if (isLow) out.push({ idx: i, price: lo, type: "L" });
  }

  out.sort((a, b) => a.idx - b.idx);

  const reduced = [];
  for (const p of out) {
    if (!reduced.length) {
      reduced.push(p);
      continue;
    }
    const last = reduced[reduced.length - 1];
    if (last.type === p.type) {
      if (p.type === "H") {
        if (p.price > last.price) reduced[reduced.length - 1] = p;
      } else {
        if (p.price < last.price) reduced[reduced.length - 1] = p;
      }
    } else {
      reduced.push(p);
    }
  }

  return reduced;
}

function lastNPivots(pivots, n) {
  if (!Array.isArray(pivots) || pivots.length < n) return null;
  const slice = pivots.slice(-n);
  return slice.length === n ? slice : null;
}

function ratioScore(r, lo, hi) {
  if (!Number.isFinite(r) || !Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
  if (r < lo || r > hi) return 0;
  const mid = (lo + hi) / 2;
  const span = Math.max(1e-9, (hi - lo) / 2);
  return Math.max(0, 1 - Math.abs(r - mid) / span);
}

function choosePattern({ xa, ab, bc }) {
  const abRatio = ab / xa;
  const bcRatio = bc / ab;

  const patterns = [
    { name: "GARTLEY", ab: [0.55, 0.7], bc: [0.382, 0.886], d: [0.786, 0.786], dSource: "XA", bcExt: [1.27, 1.618] },
    { name: "BAT", ab: [0.35, 0.55], bc: [0.382, 0.886], d: [0.886, 0.886], dSource: "XA", bcExt: [1.618, 2.618] },
    { name: "BUTTERFLY", ab: [0.72, 0.88], bc: [0.382, 0.886], d: [1.27, 1.618], dSource: "XA", bcExt: [1.618, 2.618] },
    { name: "CRAB", ab: [0.382, 0.618], bc: [0.382, 0.886], d: [1.618, 1.618], dSource: "XA", bcExt: [2.24, 3.618] },
    { name: "CYPHER", ab: [0.382, 0.618], bc: [1.272, 1.414], d: [0.786, 0.786], dSource: "XC", bcExt: [0, 0] },
    { name: "SHARK", ab: [0.5, 0.886], bc: [1.13, 1.618], d: [0.886, 1.13], dSource: "XC", bcExt: [0, 0] }
  ];

  let best = null;
  let bestScore = 0;

  for (const p of patterns) {
    const abScore = ratioScore(abRatio, p.ab[0], p.ab[1]);
    const bcScore = ratioScore(bcRatio, p.bc[0], p.bc[1]);
    const score = (abScore + bcScore) / 2;
    if (score > bestScore) {
      bestScore = score;
      best = { ...p, score };
    }
  }

  if (!best) return null;
  return { pattern: best, score: bestScore, abRatio, bcRatio };
}

function computePrz({ direction, X, A, B, C, pattern }) {
  const xa = Math.abs(A - X);
  const bc = Math.abs(C - B);
  const xc = Math.abs(C - X);
  const dir = direction === "LONG" ? -1 : 1;

  const dRatio = (pattern.d[0] + pattern.d[1]) / 2;
  let d1 = null;
  if (pattern.dSource === "XC") d1 = C + dir * (dRatio * xc);
  else d1 = A + dir * (dRatio * xa);

  let d2 = d1;
  if (pattern.bcExt && (pattern.bcExt[0] > 0 || pattern.bcExt[1] > 0)) {
    const ext = (pattern.bcExt[0] + pattern.bcExt[1]) / 2;
    d2 = C + dir * (ext * bc);
  }

  const low = Math.min(d1, d2);
  const high = Math.max(d1, d2);
  let near = direction === "LONG" ? high : low;
  let far = direction === "LONG" ? low : high;

  const span = Math.abs(near - far);
  if (!Number.isFinite(span) || span === 0) {
    const band = Math.max(Math.abs(near) * 0.001, Math.abs(C - B) * 0.05);
    if (direction === "LONG") {
      near = near + band;
      far = far - band;
    } else {
      near = near - band;
      far = far + band;
    }
  }

  return { d1, d2, near, far };
}

function scoreFromPattern(baseScore, prz, D = null) {
  const przTight = Math.abs(prz.d1 - prz.d2);
  const przScore = Math.max(0, 1 - Math.min(1, przTight / Math.max(1e-9, Math.abs(prz.near) * 0.01)));
  let dScore = 0.5;
  if (D != null && Number.isFinite(D)) {
    const low = Math.min(prz.d1, prz.d2);
    const high = Math.max(prz.d1, prz.d2);
    const tol = Math.max(Math.abs(high - low) * 0.4, Math.abs(D) * 0.0025);
    dScore = (D >= (low - tol) && D <= (high + tol)) ? 1 : 0;
  }
  const score = (baseScore * 0.6 + przScore * 0.25 + dScore * 0.15) * 100;
  return Math.max(0, Math.min(100, score));
}

function buildLevels({ direction, entryLow, entryHigh, C, D = null }) {
  const near = Number(entryLow);
  const far = Number(entryHigh);
  const low = Math.min(near, far);
  const high = Math.max(near, far);
  const entryMid = (near + far) / 2;
  const span = Math.max(Math.abs(C - entryMid), Math.abs(C - (D ?? entryMid)));
  const buffer = Math.max(Math.abs(high - low) * 0.5, Math.abs(entryMid) * 0.001);

  const dir = direction === "SHORT" ? -1 : 1;
  const sl = direction === "SHORT" ? (high + buffer) : (low - buffer);

  const base = span || Math.max(Math.abs(entryMid) * 0.01, 1e-9);
  const tp1 = entryMid + dir * 0.618 * base;
  const tp2 = entryMid + dir * 1.0 * base;
  const tp3 = entryMid + dir * 1.272 * base;

  return { entryLow: near, entryHigh: far, entryMid, sl, tp1, tp2, tp3 };
}

function buildSignal({ symbol, tf, direction, score, candles, levels }) {
  return {
    symbol,
    tf,
    direction,
    playbook: playbookForTf(tf),
    score: Math.round(score),
    strategyKey: "NEW_DM_HARMONIC",
    candleCloseTime: candles?.length ? candles[candles.length - 1]?.closeTime : null,
    candles: Array.isArray(candles) ? candles.slice(-200) : [],
    levels
  };
}

function resolveDirection(pivots) {
  const types = pivots.map((p) => p.type).join("");
  if (types === "HLHL") return "LONG";
  if (types === "LHLH") return "SHORT";
  if (types === "HLHLH") return "LONG";
  if (types === "LHLHL") return "SHORT";
  return null;
}

export function evaluateDmHarmonicPotential(symbol, tf, candles) {
  const pivots = pivotCandidates(candles, 4);
  const last4 = lastNPivots(pivots, 4);
  if (!last4) return null;

  const direction = resolveDirection(last4);
  if (!direction) return null;

  const X = last4[0].price;
  const A = last4[1].price;
  const B = last4[2].price;
  const C = last4[3].price;

  const xa = Math.abs(A - X);
  const ab = Math.abs(B - A);
  const bc = Math.abs(C - B);
  if (!xa || !ab || !bc) return null;

  const picked = choosePattern({ xa, ab, bc });
  if (!picked || picked.score <= 0) return null;

  const prz = computePrz({ direction, X, A, B, C, pattern: picked.pattern });
  const score = scoreFromPattern(picked.score, prz, null);

  const levels = buildLevels({
    direction,
    entryLow: prz.near,
    entryHigh: prz.far,
    C
  });

  return buildSignal({ symbol, tf, direction, score, candles, levels });
}

export function evaluateDmHarmonicComplete(symbol, tf, candles) {
  const pivots = pivotCandidates(candles, 4);
  const last5 = lastNPivots(pivots, 5);
  if (!last5) return null;

  const direction = resolveDirection(last5);
  if (!direction) return null;

  const X = last5[0].price;
  const A = last5[1].price;
  const B = last5[2].price;
  const C = last5[3].price;
  const D = last5[4].price;

  const xa = Math.abs(A - X);
  const ab = Math.abs(B - A);
  const bc = Math.abs(C - B);
  if (!xa || !ab || !bc) return null;

  const picked = choosePattern({ xa, ab, bc });
  if (!picked || picked.score <= 0) return null;

  const prz = computePrz({ direction, X, A, B, C, pattern: picked.pattern });
  const low = Math.min(prz.d1, prz.d2);
  const high = Math.max(prz.d1, prz.d2);
  const tol = Math.max(Math.abs(high - low) * 0.4, Math.abs(D) * 0.0025);
  if (!(D >= (low - tol) && D <= (high + tol))) return null;

  const score = scoreFromPattern(picked.score, prz, D);

  const entryLow = Math.min(low, D);
  const entryHigh = Math.max(high, D);

  const levels = buildLevels({
    direction,
    entryLow,
    entryHigh,
    C,
    D
  });

  return buildSignal({ symbol, tf, direction, score, candles, levels });
}
