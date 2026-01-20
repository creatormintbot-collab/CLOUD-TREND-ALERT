export function startKlinesPersistJob({ intervalSec = 30, run }) {
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await run(); } finally { busy = false; }
  }, Number(intervalSec) * 1000);

  return { stop: () => clearInterval(t) };
}
