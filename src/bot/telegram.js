import https from "https";
import TelegramBot from "node-telegram-bot-api";
import { logger } from "../logger/logger.js";

const agent = new https.Agent({ keepAlive: true, maxSockets: 50 });

export function startTelegram(token) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is missing");

  const bot = new TelegramBot(token, {
    polling: {
      autoStart: true,
      interval: 500,
      params: { timeout: 30 }
    },
    request: {
      agent,
      timeout: 45_000
    }
  });

  // Ensure polling mode works even if a webhook was previously set.
  // Best-effort; do not fail startup.
  try {
    bot.deleteWebHook({ drop_pending_updates: true }).catch((err) => {
      logger.warn({ err }, "[telegram] deleteWebHook failed");
    });
  } catch (err) {
    logger.warn({ err }, "[telegram] deleteWebHook threw");
  }

  // Recover from transient network issues without crashing / requiring PM2 restarts.
  let backoffMs = 1_000;
  const backoffMax = 30_000;
  let restartTimer = null;

  const scheduleRestart = () => {
    if (restartTimer) return;

    const wait = backoffMs;
    restartTimer = setTimeout(() => {
      restartTimer = null;

      bot.startPolling()
        .then(() => {
          backoffMs = 1_000;
          logger.info("[telegram] polling resumed");
        })
        .catch((e) => {
          logger.error({ err: e }, "[telegram] startPolling failed");
          backoffMs = Math.min(backoffMax, Math.floor(backoffMs * 1.7));
          scheduleRestart();
        });
    }, wait);

    backoffMs = Math.min(backoffMax, Math.floor(backoffMs * 1.7));
  };

  bot.on("polling_error", async (err) => {
    // Common: ECONNRESET, ETIMEDOUT. Treat as recoverable.
    logger.error({ err }, "[telegram] polling_error");

    try {
      await bot.stopPolling();
    } catch (e) {
      logger.warn({ err: e }, "[telegram] stopPolling failed");
    }

    scheduleRestart();
  });

  bot.on("webhook_error", (err) => {
    logger.error({ err }, "[telegram] webhook_error");
  });

  return bot;
}
