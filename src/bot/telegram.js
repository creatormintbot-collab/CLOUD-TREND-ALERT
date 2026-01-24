import https from "https";
import TelegramBot from "node-telegram-bot-api";
import { logger } from "../logger/logger.js";

const agent = new https.Agent({ keepAlive: true, maxSockets: 50 });

export function startTelegram(token) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is missing");

  logger.info("[telegram] starting (polling)");

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
    const delHook = bot.deleteWebHook || bot.deleteWebhook;
    if (typeof delHook === "function") {
      Promise.resolve(delHook.call(bot, { drop_pending_updates: true })).catch((err) => {
        logger.warn({ err }, "[telegram] deleteWebhook failed");
      });
    } else {
      logger.warn("[telegram] deleteWebhook method not available on bot instance");
    }
  } catch (err) {
    logger.warn({ err }, "[telegram] deleteWebhook threw");
  }

  // Quick connectivity + token sanity check (non-fatal)
  bot.getMe()
    .then((me) => {
      logger.info({ id: me?.id, username: me?.username }, "[telegram] getMe ok");
    })
    .catch((err) => {
      logger.error({ err }, "[telegram] getMe failed");
    });

  // Ensure polling is started (autoStart should do this, but we guard for edge cases).
  setTimeout(() => {
    bot.startPolling()
      .then(() => {
        logger.info("[telegram] polling started");
      })
      .catch((err) => {
        // Common benign case: polling already started
        logger.warn({ err }, "[telegram] startPolling initial failed");
      });
  }, 0);

  // Lightweight command trace (helps diagnose 'bot not responding' cases)
  bot.on("message", (msg) => {
    const text = msg?.text;
    if (typeof text === "string" && text.startsWith("/")) {
      logger.info(
        { chatId: msg?.chat?.id, fromId: msg?.from?.id, text: text.slice(0, 64) },
        "[telegram] command received"
      );
    }
  });

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
    const msg = String(err?.message || "");
    const code = Number(err?.code || err?.response?.statusCode || err?.response?.status);
    if (code === 409 || msg.includes("409") || msg.toLowerCase().includes("conflict")) {
      logger.error({ err }, "[telegram] polling_error (409 conflict) — another instance is polling. Stop other bots.");
      backoffMs = Math.max(backoffMs, 10_000);
    } else {
      logger.error({ err }, "[telegram] polling_error");
    }

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