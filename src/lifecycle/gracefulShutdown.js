export function setupGracefulShutdown(app) {
  let done = false;
  const on = async (sig) => {
    if (done) return;
    done = true;
    try { await app.stop?.(); } finally { process.exit(0); }
  };
  process.on("SIGINT", on);
  process.on("SIGTERM", on);
}
