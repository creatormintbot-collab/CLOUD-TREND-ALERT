export function adx(candles, period = 14) {
  const p = Number(period);
  const out = new Array(candles.length).fill(null);
  if (candles.length < p + 2) return out;

  const plusDM = new Array(candles.length).fill(0);
  const minusDM = new Array(candles.length).fill(0);
  const tr = new Array(candles.length).fill(0);

  for (let i = 1; i < candles.length; i++) {
    const hi = Number(candles[i].high), lo = Number(candles[i].low);
    const ph = Number(candles[i - 1].high), pl = Number(candles[i - 1].low);
    const pc = Number(candles[i - 1].close);

    const up = hi - ph;
    const down = pl - lo;

    plusDM[i] = (up > down && up > 0) ? up : 0;
    minusDM[i] = (down > up && down > 0) ? down : 0;

    const a = hi - lo;
    const b = Math.abs(hi - pc);
    const c = Math.abs(lo - pc);
    tr[i] = Math.max(a, b, c);
  }

  function rma(arr) {
    const r = new Array(arr.length).fill(null);
    let sum = 0;
    for (let i = 1; i <= p; i++) sum += arr[i];
    r[p] = sum;
    for (let i = p + 1; i < arr.length; i++) r[i] = r[i - 1] - (r[i - 1] / p) + arr[i];
    return r;
  }

  const trR = rma(tr);
  const plusR = rma(plusDM);
  const minusR = rma(minusDM);

  const dx = new Array(candles.length).fill(null);
  for (let i = p; i < candles.length; i++) {
    const trv = trR[i];
    if (!trv) continue;
    const pdi = 100 * (plusR[i] / trv);
    const mdi = 100 * (minusR[i] / trv);
    const denom = pdi + mdi;
    dx[i] = denom === 0 ? 0 : (100 * Math.abs(pdi - mdi) / denom);
  }

  // ADX = RMA of DX
  let sum = 0;
  let start = p * 2;
  if (candles.length <= start) return out;
  for (let i = p; i < start; i++) sum += dx[i] ?? 0;
  out[start - 1] = sum / p;

  for (let i = start; i < candles.length; i++) {
    out[i] = ((out[i - 1] * (p - 1)) + (dx[i] ?? 0)) / p;
  }

  return out;
}
