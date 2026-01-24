export function startMonitorJob({ intervalSec = 10, run, onError = null }) {
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await run();
    } catch (err) {
      try {
        if (typeof onError === "function") await onError(err);
        else console.error("[monitorJob] run() failed:", err);
      } catch {}
    } finally {
      busy = false;
    }
  }, Number(intervalSec) * 1000);
  return { stop: () => clearInterval(t) };
}