import { utcNowHHMM, yesterdayUtcKey, utcDateKey } from "../utils/time.js";

export function startDailyRecapJob({ hhmmUTC = "00:05", run }) {
  let lastTickDay = "";
  const t = setInterval(async () => {
    const now = utcNowHHMM();
    if (now !== hhmmUTC) return;

    const yKey = yesterdayUtcKey();
    if (lastTickDay === yKey) return;
    lastTickDay = yKey;

    await run(yKey);
  }, 30_000);

  return { stop: () => clearInterval(t) };
}

// Optional helper for manual trigger (e.g., /info) without duplicating recap logic.
// Does NOT change existing scheduling behaviour.
export async function runDailyRecapNow({ run, dayKey = null } = {}) {
  if (typeof run !== "function") return;
  const key = dayKey ? String(dayKey) : utcDateKey();
  await run(key);
}