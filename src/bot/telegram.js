import TelegramBot from "node-telegram-bot-api";
import { helpText } from "./commands/help.js";
import { topText } from "./commands/top.js";
import { handleScanCommand } from "./commands/scan.js";

export function createTelegramBot({ env, logger, scanner }) {
  // Accept both TELEGRAM_BOT_TOKEN (preferred) and BOT_TOKEN (legacy)
  const token = (env?.TELEGRAM_BOT_TOKEN ?? env?.BOT_TOKEN ?? "").toString().trim();
  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN/BOT_TOKEN");
  }

  const bot = new TelegramBot(token, { polling: true });

  // Normalize allowed group IDs (Telegram chatId is a number, but env may produce strings)
  const allowedSet = new Set(
    Array.isArray(env?.ALLOWED_GROUP_IDS)
      ? env.ALLOWED_GROUP_IDS.map((v) => String(v).trim()).filter(Boolean)
      : []
  );

  const isAllowed = (chatId) => {
    const cid = String(chatId);
    if (allowedSet.size) return allowedSet.has(cid);
    if (env?.TELEGRAM_CHAT_ID) return cid === String(env.TELEGRAM_CHAT_ID);
    return true;
  };

  // Surface polling issues (otherwise it looks like the bot is "running" but ignores messages)
  bot.on("polling_error", (err) => {
    logger.warn({ err: String(err) }, "Telegram polling error");
  });
  bot.on("webhook_error", (err) => {
    logger.warn({ err: String(err) }, "Telegram webhook error");
  });
  bot.on("error", (err) => {
    logger.warn({ err: String(err) }, "Telegram error");
  });

  bot.on("message", async (msg) => {
    const chatId = msg?.chat?.id;
    if (chatId == null) return;
    if (!isAllowed(chatId)) return;

    // basic logging
    if (msg.text?.startsWith("/")) {
      logger.info({ chatId, text: msg.text }, "Telegram command");
    }
  });

  bot.onText(/^\/ping\b/, async (msg) => {
    if (!isAllowed(msg.chat.id)) return;
    try {
      await bot.sendMessage(msg.chat.id, "pong ✅");
    } catch (e) {
      logger.error({ err: String(e) }, "Failed to reply /ping");
    }
  });

  bot.onText(/^\/help\b/, async (msg) => {
    if (!isAllowed(msg.chat.id)) return;
    try {
      await bot.sendMessage(msg.chat.id, helpText(), { parse_mode: "HTML" });
    } catch (e) {
      logger.error({ err: String(e) }, "Failed to reply /help");
    }
  });

  bot.onText(/^\/top\b/, async (msg) => {
    if (!isAllowed(msg.chat.id)) return;
    try {
      const u = scanner.getUniverse();
      await bot.sendMessage(msg.chat.id, topText(u), { parse_mode: "HTML" });
    } catch (e) {
      logger.error({ err: String(e) }, "Failed to reply /top");
    }
  });

  bot.onText(/^\/scan(?:\s+(.+))?$/, async (msg, match) => {
    if (!isAllowed(msg.chat.id)) return;
    try {
      const raw = (match?.[1] ?? "").trim();
      const args = raw ? raw.split(/\s+/) : [];
      await handleScanCommand({
        bot,
        chatId: msg.chat.id,
        args,
        scanner,
        logger
      });
    } catch (e) {
      logger.error({ err: String(e) }, "Failed to handle /scan");
      try {
        await bot.sendMessage(msg.chat.id, "Scan error. Coba lagi bentar ya.");
      } catch {
        // ignore
      }
    }
  });

  logger.info(
    {
      allowed_groups: allowedSet.size ? Array.from(allowedSet).slice(0, 10) : undefined,
      telegram_chat_id: env?.TELEGRAM_CHAT_ID ? String(env.TELEGRAM_CHAT_ID) : undefined
    },
    "Telegram bot polling started"
  );

  return bot;
}