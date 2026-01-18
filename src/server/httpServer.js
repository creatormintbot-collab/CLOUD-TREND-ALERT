import express from "express";

// Minimal HTTP server for health/ready checks in VPS / PM2 environments.
// Kept intentionally small to avoid side effects.
export function createServer({ env, logger, statusProvider } = {}) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => res.status(200).send("CloudTrend Alert server OK ✅"));
  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

  // Readiness: returns richer info when available, but never throws.
  app.get("/readyz", (_req, res) => {
    try {
      const s = (typeof statusProvider?.getStatus === "function" ? statusProvider.getStatus() : {}) || {};
      return res.status(200).json({ ok: true, ...s });
    } catch (e) {
      logger?.warn?.({ err: String(e) }, "readyz statusProvider error");
      return res.status(200).json({ ok: true });
    }
  });

  const port = Number(env?.PORT) || 3000;
  const server = app.listen(port, () => {
    logger?.info?.({ port }, "HTTP server listening");
  });
  return server;
}