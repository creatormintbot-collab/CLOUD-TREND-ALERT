const PREMIUM_VALID_TFS = new Set(["15m", "30m", "1h", "4h"]);
const PIVOT_TRAILING_BARS = 7;
const MIN_CANDLES = 220;
const STOP_PCT = 75;
const ENTRY_TOLERANCE_PCT = 0.01;

const PATTERN_DEFS = [
  {
    name: "GARTLEY",
    rules: [
      { key: "ab_xa", type: "point", value: 0.618 },
      { key: "bc_ab", type: "range", min: 0.382, max: 0.886 },
      { key: "cd_bc", type: "range", min: 1.13, max: 1.618 },
      { key: "ad_xa", type: "point", value: 0.786 }
    ],
    targets: ["0.382 AD", "0.618 AD", "1.000 AD"]
  },
  {
    name: "BAT",
    rules: [
      { key: "ab_xa", type: "range", min: 0.382, max: 0.500 },
      { key: "bc_ab", type: "range", min: 0.382, max: 0.886 },
      { key: "cd_bc", type: "range", min: 1.618, max: 2.618 },
      { key: "ad_xa", type: "point", value: 0.886 }
    ],
    targets: ["0.382 AD", "0.618 AD", "1.000 AD"]
  },
  {
    name: "BUTTERFLY",
    rules: [
      { key: "ab_xa", type: "point", value: 0.786 },
      { key: "bc_ab", type: "range", min: 0.382, max: 0.886 },
      { key: "cd_bc", type: "range", min: 1.618, max: 2.240 },
      { key: "ad_xa", type: "range", min: 1.270, max: 1.618 }
    ],
    targets: ["0.382 AD", "0.618 AD", "1.000 AD"]
  },
  {
    name: "CRAB",
    rules: [
      { key: "ab_xa", type: "range", min: 0.382, max: 0.618 },
      { key: "bc_ab", type: "range", min: 0.382, max: 0.886 },
      { key: "cd_bc", type: "range", min: 2.240, max: 3.618 },
      { key: "ad_xa", type: "point", value: 1.618 }
    ],
    targets: ["0.382 AD", "0.618 AD", "1.000 AD"]
  },
  {
    name: "SHARK",
    rules: [
      { key: "ab_xa", type: "range", min: 0.500, max: 0.886 },
      { key: "bc_xa", type: "range", min: 1.130, max: 1.618 },
      { key: "cd_bc", type: "range", min: 1.618, max: 2.240 },
      { key: "xd_xa", type: "range", min: 0.886, max: 1.130 }
    ],
    targets: ["0.382 CD", "0.618 CD", "1.000 CD"]
  },
  {
    name: "CYPHER",
    rules: [
      { key: "ab_xa", type: "range", min: 0.382, max: 0.618 },
      { key: "bc_xa", type: "range", min: 1.130, max: 1.414 },
      { key: "cd_xc", type: "point", value: 0.786 },
      { key: "xd_xa", type: "range", min: 0.750, max: 0.950 }
    ],
    targets: ["0.618 CD", "1.000 CD", "1.272 CD"]
  }
];

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function uniqueValidTfs(tfs) {
  const out = [];
  const seen = new Set();

  for (const raw of Array.isArray(tfs) ? tfs : []) {
    const tf = String(raw || "").trim().toLowerCase();
    if (!PREMIUM_VALID_TFS.has(tf) || seen.has(tf)) continue;
    seen.add(tf);
    out.push(tf);
  }

  return out;
}

function isPivotHigh(candles, i, trail) {
  const p = toNum(candles?.[i]?.high);
  if (!Number.isFinite(p)) return false;

  for (let j = i - trail; j <= i + trail; j++) {
    if (j === i) continue;
    const h = toNum(candles?.[j]?.high);
    if (!Number.isFinite(h)) return false;
    if (h >= p) return false;
  }

  return true;
}

function isPivotLow(candles, i, trail) {
  const p = toNum(candles?.[i]?.low);
  if (!Number.isFinite(p)) return false;

  for (let j = i - trail; j <= i + trail; j++) {
    if (j === i) continue;
    const l = toNum(candles?.[j]?.low);
    if (!Number.isFinite(l)) return false;
    if (l <= p) return false;
  }

  return true;
}

function detectPivots(candles, trail = PIVOT_TRAILING_BARS) {
  const arr = Array.isArray(candles) ? candles : [];
  if (arr.length < (trail * 2 + 5)) return [];

  const raw = [];

  for (let i = trail; i < arr.length - trail; i++) {
    const high = isPivotHigh(arr, i, trail);
    const low = isPivotLow(arr, i, trail);

    if (!high && !low) continue;

    if (high) {
      raw.push({
        i,
        type: "H",
        price: Number(arr[i].high),
        closeTime: Number(arr[i]?.closeTime || 0)
      });
    }

    if (low) {
      raw.push({
        i,
        type: "L",
        price: Number(arr[i].low),
        closeTime: Number(arr[i]?.closeTime || 0)
      });
    }
  }

  raw.sort((a, b) => a.i - b.i);

  const compact = [];
  for (const p of raw) {
    if (!compact.length) {
      compact.push(p);
      continue;
    }

    const prev = compact[compact.length - 1];
    if (prev.type !== p.type) {
      compact.push(p);
      continue;
    }

    if (p.type === "H" && p.price >= prev.price) compact[compact.length - 1] = p;
    if (p.type === "L" && p.price <= prev.price) compact[compact.length - 1] = p;
  }

  return compact;
}

function ratiosFromPoints(points) {
  if (!Array.isArray(points) || points.length !== 5) return null;
  const [X, A, B, C, D] = points;

  const XA = Math.abs(A.price - X.price);
  const AB = Math.abs(B.price - A.price);
  const BC = Math.abs(C.price - B.price);
  const CD = Math.abs(D.price - C.price);
  const AD = Math.abs(D.price - A.price);
  const XD = Math.abs(D.price - X.price);
  const XC = Math.abs(C.price - X.price);

  if ([XA, AB, BC, CD, AD, XD, XC].some((x) => !Number.isFinite(x) || x <= 0)) return null;

  return {
    ab_xa: AB / XA,
    bc_ab: BC / AB,
    cd_bc: CD / BC,
    ad_xa: AD / XA,
    xd_xa: XD / XA,
    bc_xa: BC / XA,
    cd_xc: CD / XC
  };
}

function qualityForRule(actual, rule) {
  if (!Number.isFinite(actual) || !rule) return 0;

  if (rule.type === "point") {
    const target = Number(rule.value);
    if (!Number.isFinite(target) || target <= 0) return 0;

    const tol = Math.max(Math.abs(target) * 0.20, 0.08);
    const err = Math.abs(actual - target);
    return clamp(1 - (err / tol), 0, 1);
  }

  if (rule.type === "range") {
    const min = Number(rule.min);
    const max = Number(rule.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return 0;

    if (actual >= min && actual <= max) return 1;

    const dist = actual < min ? (min - actual) : (actual - max);
    const span = Math.max(max - min, 0.08);
    return clamp(1 - (dist / span), 0, 1);
  }

  return 0;
}

function scorePattern(ratios, patternDef) {
  const rules = Array.isArray(patternDef?.rules) ? patternDef.rules : [];
  if (!rules.length) return { score: 0, qualities: [] };

  const qualities = [];
  for (const rule of rules) {
    const actual = Number(ratios?.[rule.key]);
    qualities.push(qualityForRule(actual, rule));
  }

  const avg = qualities.reduce((sum, q) => sum + q, 0) / qualities.length;
  const score = Math.round(clamp(avg * 100, 0, 100));
  return { score, qualities };
}

function parseTargetLabel(label) {
  const text = String(label || "").trim().toUpperCase();
  const m = text.match(/^([0-9]*\.?[0-9]+)\s*(AD|CD|XA)$/i);
  if (!m) return null;

  const ratio = Number(m[1]);
  const leg = String(m[2] || "").toUpperCase();
  if (!Number.isFinite(ratio)) return null;
  return { ratio, leg };
}

function computeTargetFromLabel(label, points) {
  const parsed = parseTargetLabel(label);
  if (!parsed || !points) return null;

  const { X, A, C, D } = points;
  const base = parsed.leg === "AD"
    ? Number(A?.price)
    : (parsed.leg === "CD" ? Number(C?.price) : Number(X?.price));

  const d = Number(D?.price);
  if (!Number.isFinite(base) || !Number.isFinite(d)) return null;

  return d + (base - d) * parsed.ratio;
}

function buildPlanForTf({ symbol, tf, candles, best, scoreThreshold }) {
  if (!best || !best.points || !best.pattern) return null;

  const score = Number(best.score || 0);
  if (!(score > Number(scoreThreshold))) return null;

  const { X, A, C, D } = best.points;
  const direction = String(D?.type || "") === "L" ? "LONG" : "SHORT";
  const entryMid = Number(D?.price);

  if (!Number.isFinite(entryMid) || entryMid <= 0) return null;

  const tolerance = Math.abs(entryMid) * ENTRY_TOLERANCE_PCT;
  const targetLabels = Array.isArray(best.pattern.targets) ? best.pattern.targets : [];

  const tp1 = computeTargetFromLabel(targetLabels[0], { X, A, C, D });
  const tp2 = computeTargetFromLabel(targetLabels[1], { X, A, C, D });
  const tp3Raw = computeTargetFromLabel(targetLabels[2], { X, A, C, D });

  if (!Number.isFinite(tp1) || !Number.isFinite(tp2)) return null;

  const sl = direction === "LONG"
    ? entryMid - Math.abs(tp1 - entryMid) * (STOP_PCT / 100)
    : entryMid + Math.abs(tp1 - entryMid) * (STOP_PCT / 100);

  if (!Number.isFinite(sl)) return null;

  const trimmedCandles = Array.isArray(candles) ? candles.slice(-260) : [];
  const candleCloseTime = Number(D?.closeTime || trimmedCandles.at(-1)?.closeTime || 0);

  if (tf === "4h") {
    return {
      kind: "SWING",
      signal: {
        ok: true,
        symbol,
        tf,
        playbook: "SWING",
        direction,
        candleCloseTime,
        score,
        scoreLabel: "HARMONIC",
        levels: {
          entryLow: entryMid - tolerance,
          entryHigh: entryMid + tolerance,
          entryMid,
          sl,
          tp1,
          tp2,
          tp3: Number.isFinite(tp3Raw) ? tp3Raw : null
        },
        candles: trimmedCandles
      }
    };
  }

  return {
    kind: "INTRADAY",
    plan: {
      ok: true,
      symbol,
      tf,
      direction,
      score,
      scoreLabel: "HARMONIC",
      candleCloseTime,
      tolerance,
      levels: {
        entry: entryMid,
        sl,
        tp1,
        tp2,
        tp3: Number.isFinite(tp3Raw) ? tp3Raw : null
      },
      candles: trimmedCandles
    }
  };
}

function bestPatternFromCandles(candles) {
  const pivots = detectPivots(candles, PIVOT_TRAILING_BARS);
  if (pivots.length < 5) return null;

  const window = pivots.slice(-5);
  const [X, A, B, C, D] = window;

  if (!X || !A || !B || !C || !D) return null;

  const ratios = ratiosFromPoints(window);
  if (!ratios) return null;

  let best = null;
  for (const pattern of PATTERN_DEFS) {
    const { score } = scorePattern(ratios, pattern);
    if (!best || score > best.score) {
      best = { pattern, score };
    }
  }

  if (!best) return null;

  return {
    ...best,
    points: { X, A, B, C, D },
    ratios
  };
}

export async function runPremiumScan({ symbol, tfs, pipeline, env, scoreThreshold = 80 } = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  const requestedTfs = uniqueValidTfs(Array.isArray(tfs) ? tfs : []);

  if (!sym || !requestedTfs.length || !pipeline) {
    return { intradayPlans: [], swingSignal: null };
  }

  try {
    if (typeof pipeline?._maybeWarmupKlines === "function") {
      await pipeline._maybeWarmupKlines([sym], requestedTfs, "premiumScan", {
        minCandles: MIN_CANDLES,
        maxSyms: 1,
        retryMs: 60000
      });
    }
  } catch {
    void env;
  }

  const intradayPlans = [];
  let swingSignal = null;

  for (const tf of requestedTfs) {
    const candles = pipeline?.klines?.getCandles?.(sym, tf) || [];
    if (!Array.isArray(candles) || candles.length < MIN_CANDLES) continue;

    const best = bestPatternFromCandles(candles);
    if (!best) continue;

    const built = buildPlanForTf({
      symbol: sym,
      tf,
      candles,
      best,
      scoreThreshold
    });

    if (!built) continue;

    if (built.kind === "SWING") swingSignal = built.signal;
    if (built.kind === "INTRADAY") intradayPlans.push(built.plan);
  }

  return { intradayPlans, swingSignal };
}
