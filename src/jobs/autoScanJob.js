export function startAutoScanJob({ run, intervalMs = 15_000, onError = null }) {
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await run();
    } catch (err) {
      try {
        if (typeof onError === "function") onError(err);
        else console.error("[autoScanJob] run() failed:", err);
      } catch {}
    } finally {
      busy = false;
    }
  }, intervalMs);
  return { stop: () => clearInterval(t) };
}