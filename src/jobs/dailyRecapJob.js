import { utcNowHHMM, yesterdayUtcKey } from "../utils/time.js";

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
