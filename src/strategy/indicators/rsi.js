export function rsi(values, period = 14) {
  const p = Number(period);
  const out = new Array(values.length).fill(null);
  if (values.length < p + 1) return out;

  let gain = 0, loss = 0;
  for (let i = 1; i <= p; i++) {
    const diff = Number(values[i]) - Number(values[i - 1]);
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  gain /= p; loss /= p;

  out[p] = loss === 0 ? 100 : 100 - (100 / (1 + gain / loss));

  for (let i = p + 1; i < values.length; i++) {
    const diff = Number(values[i]) - Number(values[i - 1]);
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    gain = (gain * (p - 1) + g) / p;
    loss = (loss * (p - 1) + l) / p;
    out[i] = loss === 0 ? 100 : 100 - (100 / (1 + gain / loss));
  }
  return out;
}
