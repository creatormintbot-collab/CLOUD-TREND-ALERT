import TelegramBot from "node-telegram-bot-api";
import { helpText } from "./commands/help.js";
import { topText } from "./commands/top.js";
import { handleScanCommand } from "./commands/scan.js";

export function createTelegramBot({ env, logger, scanner }) {
  const bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN, { polling: true });

  const isAllowed = (chatId) => {
    if (env.ALLOWED_GROUP_IDS?.length) return env.ALLOWED_GROUP_IDS.includes(Number(chatId));
    if (env.TELEGRAM_CHAT_ID) return String(chatId) === String(env.TELEGRAM_CHAT_ID);
    return true;
  };

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    if (!isAllowed(chatId)) return;

    // basic logging
    if (msg.text?.startsWith("/")) {
      logger.info({ chatId, text: msg.text }, "Telegram command");
    }
  });

  bot.onText(/^\/help\b/, async (msg) => {
    if (!isAllowed(msg.chat.id)) return;
    await bot.sendMessage(msg.chat.id, helpText(), { parse_mode: "HTML" });
  });

  bot.onText(/^\/top\b/, async (msg) => {
    if (!isAllowed(msg.chat.id)) return;
    const u = scanner.getUniverse();
    await bot.sendMessage(msg.chat.id, topText(u), { parse_mode: "HTML" });
  });

  bot.onText(/^\/scan(?:\s+(.+))?$/, async (msg, match) => {
    if (!isAllowed(msg.chat.id)) return;
    const raw = (match?.[1] ?? "").trim();
    const args = raw ? raw.split(/\s+/) : [];
    await handleScanCommand({
      bot,
      chatId: msg.chat.id,
      args,
      scanner,
      logger
    });
  });

  return bot;
}