import pino from "pino";
import path from "path";
import { fileURLToPath } from "url";

import { loadEnv } from "./config/env.js";
import { BinanceFutures } from "./exchange/binanceFutures.js";
import { CandleStore } from "./market/candleStore.js";
import { PositionStore } from "./positions/positionStore.js";
import { createTelegramBot } from "./bot/telegram.js";
import * as Cards from "./bot/ui/cards.js";
import { Scanner } from "./jobs/scanner.js";
import { startPriceMonitor } from "./jobs/priceMonitor.js";
import { startDailyRecap } from "./jobs/dailyRecap.js";
import { startUniverseRefresh } from "./jobs/universeRefresh.js";
import { createServer } from "./server/httpServer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createBotStub(logger) {
  const noop = async () => undefined;
  return {
    sendMessage: noop,
    stopPolling: noop,
    on: () => undefined,
    onText: () => undefined,
    _isStub: true,
    _scanner: null,
    logger
  };
}

async function main() {
  const env = loadEnv();

  const logLevel =
    String(env.LOG_LEVEL ?? process.env.LOG_LEVEL ?? process.env.PINO_LEVEL ?? "info").trim() || "info";

  const logger = pino({
    level: logLevel,
    base: { app: "cloud-trend-alert" }
  });

  // ensure Binance REST base URL is not empty
  const fapiBase = "https://fapi.binance.com";
  const baseKeys = [
    "BINANCE_FAPI_BASE_URL",
    "BINANCE_FAPI_URL",
    "BINANCE_FUTURES_REST_BASE_URL",
    "BINANCE_FUTURES_BASE_URL",
    "BINANCE_REST_BASE_URL",
    "BINANCE_REST_API_BASE_URL",
    "BINANCE_API_BASE_URL",
    "BINANCE_BASE_URL",
    "BINANCE_ENDPOINT"
  ];
  for (const k of baseKeys) {
    if (!env[k]) env[k] = fapiBase;
    if (!process.env[k]) process.env[k] = fapiBase;
  }

  // daily recap env key compatibility
  if (!env.DAILY_RECAP_UTC && env.DAILY_RECAP_TIME_UTC) env.DAILY_RECAP_UTC = env.DAILY_RECAP_TIME_UTC;
  if (!env.DAILY_RECAP_TIME_UTC && env.DAILY_RECAP_UTC) env.DAILY_RECAP_TIME_UTC = env.DAILY_RECAP_UTC;

  const dataDir = path.join(__dirname, "..", "data");
  const positionStore = new PositionStore({ dataDir, logger, env });

  // Candle limit: keep moderate to reduce memory footprint
  const candleLimit = Number(env.CANDLE_LIMIT ?? 350);
  const candleStore = new CandleStore({ limit: candleLimit, logger });

  const binance = new BinanceFutures(env, logger);

  // Telegram
  let bot = createBotStub(logger);
  try {
    bot = createTelegramBot({ env, logger, scanner: { getUniverse: () => positionStore.getUniverse() } });
    logger.info("Telegram bot started (polling)");
  } catch (e) {
    logger.warn({ err: String(e) }, "Telegram bot NOT started; using stub bot");
    bot = createBotStub(logger);
  }

  // Scanner
  const scanner = new Scanner({
    env,
    logger,
    binance,
    candleStore,
    positionStore,
    bot,
    cardBuilder: Cards
  });

  bot._scanner = scanner;

  // Server (health/ready)
  const server = createServer({
    env,
    logger,
    statusProvider: {
      getStatus: () => {
        const now = Date.now();
        const runningCount =
          typeof positionStore.listRunning === "function" ? positionStore.listRunning().length : undefined;
        return {
          app: "cloud-trend-alert",
          ts: new Date(now).toISOString(),
          uptimeSec: Math.floor(process.uptime()),
          positionsRunning: runningCount
        };
      }
    }
  });

  // =========================
  // BOOTSTRAP (FOCUSED FIX)
  // =========================
  // Default: NO backfill at boot (prevents OOM from unbounded backfillKlines behavior)
  // Enable only if you REALLY want: BOOTSTRAP_BACKFILL=1
  const doBackfill = String(env.BOOTSTRAP_BACKFILL ?? "").trim() === "1";

  // 1) init universe first
  await scanner.initUniverse();

  // 2) start WS as soon as possible (will no-op if universe empty, based on scanner guard)
  await scanner.startAutoWs();

  // 3) backfill only if explicitly enabled
  if (doBackfill) {
    logger.warn("BOOTSTRAP_BACKFILL=1 enabled: running macro + primary backfill (can be heavy)");
    await scanner.backfillMacro();
    await scanner.backfillAllPrimary();
  } else {
    logger.warn("BOOTSTRAP_BACKFILL disabled (default): skipping macro/primary backfill to prevent OOM");
  }

  // Jobs
  const stopMonitor = startPriceMonitor({
    env,
    logger,
    binance,
    candleStore,
    positionStore,
    bot,
    cardBuilder: Cards
  });

  const stopRecap = startDailyRecap({
    env,
    logger,
    positionStore,
    bot
  });

  const stopUniverse = startUniverseRefresh({
    env,
    logger,
    binance,
    scanner
  });

  logger.info("CLOUD TREND ALERT started (AUTO + ON-DEMAND)");

  let shuttingDown = false;
  const shutdown = async (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.warn({ sig }, "Graceful shutdown begin");

    try {
      stopMonitor?.();
      stopRecap?.();
      stopUniverse?.();
    } catch (e) {
      logger.warn({ err: String(e) }, "Error stopping jobs");
    }

    try {
      await binance?.unsubscribeAll?.();
    } catch (e) {
      logger.warn({ err: String(e) }, "Error closing Binance subscriptions");
    }

    try {
      positionStore?.save?.();
    } catch (e) {
      logger.warn({ err: String(e) }, "Error saving PositionStore");
    }

    try {
      await bot?.stopPolling?.();
    } catch (e) {
      logger.warn({ err: String(e) }, "Error stopping Telegram polling");
    }

    try {
      await new Promise((resolve) => {
        if (!server?.close) return resolve();
        server.close(() => resolve());
      });
    } catch (e) {
      logger.warn({ err: String(e) }, "Error closing HTTP server");
    }

    logger.warn("Shutdown complete");
    process.exit(0);
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  // Keep legacy binding gate as-is
  const bindCommandsInIndex = String(env.BIND_COMMANDS_IN_INDEX ?? "").trim() === "1";
  if (bindCommandsInIndex) {
    logger.warn("Binding Telegram commands from index.js (legacy mode)");
    // (biarin bagian lo yang existing di bawah sini tetap)
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
