export function adx(candles, period = 14) {
  if (candles.length < period * 2 + 1) return null;

  // Wilder's smoothing (simplified, stable enough for locked gate ADX>=18)
  const n = candles.length;

  let plusDM = [];
  let minusDM = [];
  let trArr = [];

  for (let i = 1; i < n; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];

    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);

    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    trArr.push(tr);
  }

  const smooth = (arr, p) => {
    let out = [];
    let first = 0;
    for (let i = 0; i < p; i++) first += arr[i];
    out[p - 1] = first;
    for (let i = p; i < arr.length; i++) {
      out[i] = out[i - 1] - out[i - 1] / p + arr[i];
    }
    return out;
  };

  const smTR = smooth(trArr, period);
  const smPlus = smooth(plusDM, period);
  const smMinus = smooth(minusDM, period);

  const diPlus = [];
  const diMinus = [];
  for (let i = period - 1; i < trArr.length; i++) {
    const tr = smTR[i];
    if (!tr) continue;
    diPlus[i] = (100 * smPlus[i]) / tr;
    diMinus[i] = (100 * smMinus[i]) / tr;
  }

  const dx = [];
  for (let i = period - 1; i < trArr.length; i++) {
    const p = diPlus[i] ?? 0;
    const m = diMinus[i] ?? 0;
    const denom = p + m;
    dx[i] = denom === 0 ? 0 : (100 * Math.abs(p - m)) / denom;
  }

  // ADX smoothing
  let adxVal = 0;
  let count = 0;
  for (let i = period - 1; i < period - 1 + period; i++) {
    if (dx[i] === undefined) continue;
    adxVal += dx[i];
    count++;
  }
  if (!count) return null;
  adxVal /= count;

  for (let i = period - 1 + period; i < dx.length; i++) {
    if (dx[i] === undefined) continue;
    adxVal = (adxVal * (period - 1) + dx[i]) / period;
  }

  return adxVal;
}
