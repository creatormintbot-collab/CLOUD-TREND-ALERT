import { ENV } from "../config/env.js";

async function tg(method, payload) {
  const url = `https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) {
    throw new Error(`Telegram ${method} failed: ${JSON.stringify(j)}`);
  }
  return j.result;
}

export async function sendToAllowedChats({ html, buttons }) {
  const chatIds = ENV.ALLOWED_GROUP_IDS;
  if (!chatIds.length) return;

  const replyMarkup = buttons?.length
    ? {
        inline_keyboard: buttons.map((row) =>
          row.map((b) => ({
            text: b.text,
            url: b.url,
            callback_data: b.callback_data,
          }))
        ),
      }
    : undefined;

  for (const chat_id of chatIds) {
    await tg("sendMessage", {
      chat_id,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    }).catch((e) => {
      console.error(`[TG] send failed chat=${chat_id}`, e.message);
    });
  }
}
