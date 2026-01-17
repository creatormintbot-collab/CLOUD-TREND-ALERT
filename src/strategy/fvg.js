// 3-bar imbalance
// Bullish FVG: low(i) > high(i-2)
// Bearish FVG: high(i) < low(i-2)
export function detectLatestFVG(candles) {
  if (!candles || candles.length < 3) return null;
  for (let i = candles.length - 1; i >= 2; i--) {
    const c = candles[i];
    const c2 = candles[i - 2];

    if (c.low > c2.high) {
      return {
        type: "BULL",
        low: c2.high,
        high: c.low,
        index: i,
      };
    }
    if (c.high < c2.low) {
      return {
        type: "BEAR",
        low: c.high,
        high: c2.low,
        index: i,
      };
    }
  }
  return null;
}

export function fvgProximity({ fvg, entryMid, atr }) {
  if (!fvg || !Number.isFinite(entryMid) || !Number.isFinite(atr) || atr <= 0) {
    return { label: "far", score: 0 };
  }
  const inside = entryMid >= fvg.low && entryMid <= fvg.high;
  if (inside) return { label: "inside", score: 8 };

  const dist = entryMid < fvg.low ? (fvg.low - entryMid) : (entryMid - fvg.high);
  if (dist <= 0.10 * atr) return { label: "near", score: 4 };

  return { label: "far", score: 0 };
}

export function fvgScoreBundle({ candles, entryMid, atr }) {
  const fvg = detectLatestFVG(candles);
  if (!fvg) return { fvg: null, proximity: { label: "far", score: 0 }, score: 0 };

  const prox = fvgProximity({ fvg, entryMid, atr });
  const detectedScore = 10;
  const total = detectedScore + prox.score; // 10 + (0/4/8) => 10..18

  return { fvg, proximity: prox, score: total };
}
