export async function sendProgress(bot, chatId, text) {
  const msg = await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
  return msg.message_id;
}

export async function editProgress(bot, chatId, messageId, text) {
  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      disable_web_page_preview: true
    });
  } catch {
    // ignore edit failures (e.g. too old, same content)
  }
}
