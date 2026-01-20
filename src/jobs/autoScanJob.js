export function startAutoScanJob({ run }) {
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await run(); } finally { busy = false; }
  }, 15_000);
  return { stop: () => clearInterval(t) };
}
