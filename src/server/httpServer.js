import express from "express";

export function createServer({ env }) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => res.status(200).send("CloudTrend Alert server OK ✅"));
  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

  const server = app.listen(env.PORT, () => {});
  return server;
}
