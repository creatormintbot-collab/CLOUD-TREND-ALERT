export function detectFVG(candles, direction) {
  // Bullish: low(i) > high(i-2)
  // Bearish: high(i) < low(i-2)
  if (candles.length < 3) return { detected: false };

  const i = candles.length - 1;
  const c0 = candles[i];
  const c2 = candles[i - 2];

  if (direction === "LONG") {
    const detected = c0.low > c2.high;
    const gapLow = c2.high;
    const gapHigh = c0.low;
    return { detected, gapLow, gapHigh };
  } else {
    const detected = c0.high < c2.low;
    const gapLow = c0.high;
    const gapHigh = c2.low;
    return { detected, gapLow, gapHigh };
  }
}

export function scoreFVG({ fvg, price }) {
  // detected +10, inside +8, near +4
  if (!fvg?.detected) return { score: 0, tag: "none" };

  const { gapLow, gapHigh } = fvg;
  const inside = price >= gapLow && price <= gapHigh;

  if (inside) return { score: 18, tag: "inside" };

  // near: within 0.25% of nearest edge
  const nearest = price < gapLow ? gapLow : gapHigh;
  const distPct = Math.abs((price - nearest) / nearest) * 100;
  if (distPct <= 0.25) return { score: 14, tag: "near" };

  return { score: 10, tag: "detected" };
}
