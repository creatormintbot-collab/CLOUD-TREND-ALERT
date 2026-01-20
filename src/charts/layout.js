function normalizeCandles(candles) {
  const arr = Array.isArray(candles) ? candles : [];
  return arr.filter((c) => c && Number.isFinite(Number(c.close)))
    .sort((a, b) => Number(a.closeTime) - Number(b.closeTime));
}

function ema(values, period) {
  const p = Number(period);
  if (!values.length || p < 2) return [];
  const k = 2 / (p + 1);
  const out = new Array(values.length).fill(null);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function buildOverlays(signal) {
  const candles = normalizeCandles(signal?.candles || []);
  const closes = candles.map((c) => Number(c.close));
  const ema21 = ema(closes, 21);
  const ema55 = ema(closes, 55);
  const ema200 = ema(closes, 200);
  const levels = signal?.levels || {};
  return { candles, ema21, ema55, ema200, levels };
}
