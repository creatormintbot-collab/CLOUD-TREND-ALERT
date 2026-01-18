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

  // MINIMAL FIX: pino level must never be undefined (prevents crash on boot)
  // NOTE: keep behavior the same; just add safe fallback
  const logLevel =
    String(env.LOG_LEVEL ?? process.env.LOG_LEVEL ?? process.env.PINO_LEVEL ?? "info").trim() || "info";

  const logger = pino({
    level: logLevel,
    base: { app: "cloud-trend-alert" }
  });

  // MINIMAL FIX: ensure Binance REST base URL is not empty (prevents Invalid URL '/fapi/v1/klines')
  // We populate BOTH env object + process.env because some exchange layers read either.
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

  // MINIMAL FIX: daily recap env key compatibility (prevents "missing/invalid DAILY_RECAP_UTC" spam)
  // Some parts use DAILY_RECAP_UTC while env loader may expose DAILY_RECAP_TIME_UTC.
  if (!env.DAILY_RECAP_UTC && env.DAILY_RECAP_TIME_UTC) env.DAILY_RECAP_UTC = env.DAILY_RECAP_TIME_UTC;
  if (!env.DAILY_RECAP_TIME_UTC && env.DAILY_RECAP_UTC) env.DAILY_RECAP_TIME_UTC = env.DAILY_RECAP_UTC;

  const dataDir = path.join(__dirname, "..", "data");
  const positionStore = new PositionStore({ dataDir, logger, env });
  const candleStore = new CandleStore({ limit: 650, logger });

  const binance = new BinanceFutures(env, logger);

  // Telegram
  let bot = createBotStub(logger);
  try {
    bot = createTelegramBot({ env, logger, scanner: { getUniverse: () => positionStore.getUniverse() } });
    logger.info("Telegram bot started (polling)");
  } catch (e) {
    // Never crash the whole service just because Telegram env is wrong.
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

  // rebind scanner into bot commands
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

  // Bootstrap
  await scanner.initUniverse();
  await scanner.backfillMacro();
  await scanner.backfillAllPrimary();
  await scanner.startAutoWs();

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

    // Stop periodic jobs FIRST to avoid new work while shutting down
    try {
      stopMonitor?.();
      stopRecap?.();
      stopUniverse?.();
    } catch (e) {
      logger.warn({ err: String(e) }, "Error stopping jobs");
    }

    // Close external resources
    try {
      await binance?.unsubscribeAll?.();
    } catch (e) {
      logger.warn({ err: String(e) }, "Error closing Binance subscriptions");
    }

    // Persist state
    try {
      positionStore?.save?.();
    } catch (e) {
      logger.warn({ err: String(e) }, "Error saving PositionStore");
    }

    // Stop polling and HTTP server
    try {
      await bot?.stopPolling?.();
    } catch (e) {
      // stopPolling may throw if already stopped
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

  // Use .once to prevent duplicate handlers (important for PM2 restarts)
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  /**
   * IMPORTANT:
   * Commands (/scan, /top, /help) should be registered in ONE place only.
   * We prefer src/bot/telegram.js as the single source of truth.
   * This avoids duplicate handlers that can cause duplicated progress UI
   * (e.g., "Finalizing data..." appearing twice).
   *
   * If you ever need the legacy binding from index.js (not recommended),
   * you can enable it via env BIND_COMMANDS_IN_INDEX=1.
   */
  const bindCommandsInIndex = String(env.BIND_COMMANDS_IN_INDEX ?? "").trim() === "1";
  if (bindCommandsInIndex) {
    logger.warn(
      "Binding Telegram commands from index.js (legacy mode) – ensure telegram.js does not also bind commands"
    );

    // attach scanner to telegram handlers (legacy bridge)
    // (node-telegram-bot-api doesn't support DI well without refactor)
    bot.onText(/^\/scan(?:\s+(.+))?$/, async (msg, match) => {
      const chatId = msg.chat.id;
      const raw = (match?.[1] ?? "").trim();
      const args = raw ? raw.split(/\s+/) : [];
      const { handleScanCommand } = await import("./bot/commands/scan.js");
      await handleScanCommand({ bot, chatId, args, scanner, logger });
    });

    bot.onText(/^\/top\b/, async (msg) => {
      const u = scanner.getUniverse();
      const { topText } = await import("./bot/commands/top.js");
      await bot.sendMessage(msg.chat.id, topText(u), { parse_mode: "HTML" });
    });

    bot.onText(/^\/help\b/, async (msg) => {
      const { helpText } = await import("./bot/commands/help.js");
      await bot.sendMessage(msg.chat.id, helpText(), { parse_mode: "HTML" });
    });
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});