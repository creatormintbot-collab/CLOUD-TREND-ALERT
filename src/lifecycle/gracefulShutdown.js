export function setupGracefulShutdown(app) {
  const logger = app?.logger || console;
  const isRecoverableWsError = (err) => {
    const msg = String(err?.message || err || "").toLowerCase();
    return msg.includes("closed before the connection was established");
  };

  const existingUncaught = process.listeners("uncaughtException");
  if (existingUncaught.length) {
    process.removeAllListeners("uncaughtException");
    process.on("uncaughtException", (err) => {
      if (isRecoverableWsError(err)) {
        logger?.warn?.("[ws] recoverable error ignored", { message: err?.message, stack: err?.stack });
        return;
      }
      for (const handler of existingUncaught) {
        try {
          handler.call(process, err);
        } catch (e) {
          logger?.warn?.("[shutdown] uncaughtException handler failed", { message: e?.message, stack: e?.stack });
        }
      }
    });
  }

  let done = false;
  const on = async () => {
    if (done) return;
    done = true;
    try { await app.stop?.(); } finally { process.exit(0); }
  };
  process.on("SIGINT", on);
  process.on("SIGTERM", on);
}
