export function startAutoScanJob({ run, intervalMs = 15_000, onError = null }) {
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      console.log("[AUTO_SCAN] tick start");
      await run();
    } catch (err) {
      try {
        if (typeof onError === "function") await onError(err);
        else console.error("[autoScanJob] run() failed:", err);
      } catch {}
    } finally {
      console.log("[AUTO_SCAN] tick end");
      busy = false;
    }
  }, intervalMs);
  return { stop: () => clearInterval(t) };
}
