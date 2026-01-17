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

function normalizeButtons(buttons) {
  if (!buttons?.length) return undefined;

  const inline_keyboard = buttons.map((row) =>
    row
      .map((b) => {
        const btn = { text: b.text };
        if (b.url) btn.url = b.url;
        if (b.callback_data) btn.callback_data = b.callback_data;
        return btn;
      })
      .filter((b) => b?.text)
  );

  return inline_keyboard.length ? { inline_keyboard } : undefined;
}

export async function sendToAllowedChats({ html, buttons }) {
  const chatIds = ENV.ALLOWED_GROUP_IDS;
  if (!chatIds.length) return;

  const reply_markup = normalizeButtons(buttons);

  for (const chat_id of chatIds) {
    await tg("sendMessage", {
      chat_id,
      text: html ?? "",
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup,
    }).catch((e) => {
      console.error(`[TG] send failed chat=${chat_id}`, e.message);
    });
  }
}
