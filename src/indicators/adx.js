// Minimal ADX (Wilder style, simplified rolling on last N)
export function adx(candles, length = 14) {
  if (!candles || candles.length < length + 2) return null;

  const start = candles.length - (length + 1);
  let trSum = 0;
  let plusDMSum = 0;
  let minusDMSum = 0;

  for (let i = start + 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];

    const upMove = cur.high - prev.high;
    const downMove = prev.low - cur.low;

    const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;

    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );

    trSum += tr;
    plusDMSum += plusDM;
    minusDMSum += minusDM;
  }

  if (trSum === 0) return 0;

  const plusDI = (plusDMSum / trSum) * 100;
  const minusDI = (minusDMSum / trSum) * 100;
  const dx = (Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1)) * 100;

  // For MVP: return DX as proxy ADX (reasonable for strength gating >=18)
  return dx;
}
