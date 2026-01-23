export function normalizeInterval(tf) {
  return String(tf).trim().toLowerCase();
}

export function intervalToMs(tf) {
  const x = normalizeInterval(tf);
  if (x.endsWith("m")) return Number(x.slice(0, -1)) * 60_000;
  if (x.endsWith("h")) return Number(x.slice(0, -1)) * 3_600_000;
  if (x.endsWith("d")) return Number(x.slice(0, -1)) * 86_400_000;
  if (x.endsWith("w")) return Number(x.slice(0, -1)) * 604_800_000;
  throw new Error(`Unsupported interval: ${tf}`);
}

export function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
