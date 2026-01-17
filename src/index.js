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

async function main() {
  const env = loadEnv();

  const logger = pino({
    level: env.LOG_LEVEL,
    base: { app: "cloud-trend-alert" }
  });

  const dataDir = path.join(__dirname, "..", "data");
  const positionStore = new PositionStore({ dataDir, logger, env });
  const candleStore = new CandleStore({ limit: 650, logger });

  const binance = new BinanceFutures(env, logger);

  // Telegram
  const bot = createTelegramBot({ env, logger, scanner: { getUniverse: () => positionStore.getUniverse() } });

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

  // Server (health)
  const server = createServer({ env });

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

  const shutdown = async (sig) => {
    logger.warn({ sig }, "Graceful shutdown begin");
    try {
      stopMonitor?.();
      stopRecap?.();
      stopUniverse?.();
      await binance.unsubscribeAll();
      positionStore.save();
      server?.close?.();
      bot?.stopPolling?.();
    } catch (e) {
      logger.error({ err: String(e) }, "Shutdown error");
    } finally {
      logger.warn("Shutdown complete");
      process.exit(0);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // attach scanner to telegram handlers (simple bridge)
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

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
