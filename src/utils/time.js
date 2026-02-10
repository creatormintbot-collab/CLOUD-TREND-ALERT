export function utcDateKey(d = new Date()) {
  const x = new Date(d);
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(x.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function utcNowHHMM() {
  const d = new Date();
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function getUtcDayString(dateOrMs = Date.now()) {
  const d = (dateOrMs instanceof Date) ? dateOrMs : new Date(dateOrMs);
  if (Number.isNaN(d.getTime())) return utcDateKey();
  return utcDateKey(d);
}

export function yesterdayUtcKey() {
  return utcDateKey(Date.now() - 86400000);
}
