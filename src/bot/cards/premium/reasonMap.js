export const REASON_PRIORITY = [
  "WARMUP",
  "PIVOT_NOT_READY",
  "RATIO_NO_MATCH",
  "LOW_SCORE",
  "UNSPECIFIED"
];

const REASON_TEXT = {
  WARMUP: ({ minCandles }) => `Not enough closed candles yet (min ${minCandles})`,
  PIVOT_NOT_READY: () => "Not enough pivots to confirm an XABCD structure",
  RATIO_NO_MATCH: () => "No XABCD ratios matched within tolerance",
  LOW_SCORE: ({ scoreThreshold }) => `A candidate exists, but quality is below the threshold (score ≥ ${scoreThreshold})`,
  UNSPECIFIED: () => "Current price action doesn’t form a valid setup on this timeframe"
};

function normalizeReasonCode(code) {
  const raw = String(code || "").trim().toUpperCase();
  return REASON_TEXT[raw] ? raw : "";
}

export function sortReasonCodes(codes) {
  const list = Array.isArray(codes) ? codes : [codes];
  const uniq = [];
  const seen = new Set();

  for (const c of list) {
    const norm = normalizeReasonCode(c);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    uniq.push(norm);
  }

  if (!uniq.length) uniq.push("UNSPECIFIED");

  uniq.sort((a, b) => {
    const ai = REASON_PRIORITY.indexOf(a);
    const bi = REASON_PRIORITY.indexOf(b);
    const aIdx = ai === -1 ? REASON_PRIORITY.length : ai;
    const bIdx = bi === -1 ? REASON_PRIORITY.length : bi;
    return aIdx - bIdx;
  });

  return uniq;
}

export function reasonBullets(codes, { minCandles = 220, scoreThreshold = 80, maxBullets = 3 } = {}) {
  const ordered = sortReasonCodes(codes);
  const limit = Math.max(1, Math.min(Number(maxBullets) || 3, ordered.length));
  const out = [];

  for (const code of ordered.slice(0, limit)) {
    const builder = REASON_TEXT[code] || REASON_TEXT.UNSPECIFIED;
    out.push(builder({ minCandles, scoreThreshold }));
  }

  if (!out.length) {
    out.push(REASON_TEXT.UNSPECIFIED({ minCandles, scoreThreshold }));
  }

  return out;
}
