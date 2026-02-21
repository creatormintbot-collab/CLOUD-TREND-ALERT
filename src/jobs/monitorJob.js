export function startMonitorJob({ intervalSec = 10, run, onError = null, timeoutMs = 60000 }) {
  let busy = false;
  const intervalNum = Number(intervalSec);
  const safeIntervalSec = Number.isFinite(intervalNum) && intervalNum > 0 ? intervalNum : 10;
  const timeoutNum = Number(timeoutMs);
  const safeTimeoutMs = Number.isFinite(timeoutNum) && timeoutNum > 0 ? timeoutNum : 60000;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    let timeoutId = null;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const err = new Error("monitorJob timeout");
          err.code = "MONITOR_TIMEOUT";
          reject(err);
        }, safeTimeoutMs);
      });

      await Promise.race([run(), timeoutPromise]);
    } catch (err) {
      try {
        if (typeof onError === "function") await onError(err);
        else console.error("[monitorJob] run() failed:", err);
      } catch {}
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      busy = false;
    }
  }, safeIntervalSec * 1000);
  return { stop: () => clearInterval(t) };
}
