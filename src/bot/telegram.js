import TelegramBot from "node-telegram-bot-api";

export function startTelegram(token) {
  return new TelegramBot(token, { polling: true });
}
