export function startUniverseRefreshJob({ hours = 6, run, onError, immediate = true }) {
  const h = Number(hours);
  const ms = (Number.isFinite(h) && h > 0 ? h : 6) * 3_600_000;

  let running = false;
  const tick = () => {
    if (running) return;
    running = true;

    Promise.resolve()
      .then(run)
      .catch((err) => {
        if (typeof onError === "function") {
          try { onError(err); } catch {}
          return;
        }
        // Last-resort: avoid unhandled rejection crashing the process
        // eslint-disable-next-line no-console
        console.error("[universe_refresh_job] run failed", err);
      })
      .finally(() => {
        running = false;
      });
  };

  const t = setInterval(tick, ms);
  if (immediate) tick();
  return { stop: () => clearInterval(t) };
}