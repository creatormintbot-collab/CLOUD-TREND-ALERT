export function ema(values, length) {
  if (!values || values.length < length) return null;
  const k = 2 / (length + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
  }
  return e;
}

export function emaSeries(values, length) {
  if (!values || values.length < length) return [];
  const k = 2 / (length + 1);
  const out = [];
  let e = values[0];
  out.push(e);
  for (let i = 1; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}
