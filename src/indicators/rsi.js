export function rsi(closes, length = 14) {
  if (!closes || closes.length < length + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = closes.length - length; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += -diff;
  }

  const avgGain = gains / length;
  const avgLoss = losses / length;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
