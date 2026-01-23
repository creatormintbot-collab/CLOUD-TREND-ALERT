export class Sender {
  constructor({ bot, allowedGroupIds = [] } = {}) {
    this.bot = bot;
    this.allowed = new Set((allowedGroupIds || []).map(String));
  }

  _isAllowed(chatId) {
    const id = String(chatId);
    // if allowed list empty -> allow all (dev mode)
    if (this.allowed.size === 0) return true;
    return this.allowed.has(id);
  }

  async sendText(chatId, text) {
    if (!this._isAllowed(chatId)) return null;
    return this.bot.sendMessage(chatId, text, { disable_web_page_preview: true });
  }

  // Used by monitor/lifecycle flows to reply to a specific message when possible.
  // Minimal addition: if reply target is missing/invalid, fall back to normal sendMessage.
  async sendTextReply(chatId, replyToMessageId, text, options = {}) {
    if (!this._isAllowed(chatId)) return null;

    const rid =
      typeof replyToMessageId === "object" && replyToMessageId
        ? replyToMessageId.message_id
        : replyToMessageId;

    const numId = Number(rid);
    if (!Number.isFinite(numId)) {
      return this.bot.sendMessage(chatId, text, { disable_web_page_preview: true, ...options });
    }

    return this.bot.sendMessage(chatId, text, {
      disable_web_page_preview: true,
      reply_to_message_id: numId,
      allow_sending_without_reply: true,
      ...options,
    });
  }

  async editText(chatId, messageId, text) {
    if (!this._isAllowed(chatId)) return null;
    return this.bot.editMessageText(text, { chat_id: chatId, message_id: messageId, disable_web_page_preview: true });
  }

  async sendPhoto(chatId, buffer, options = {}) {
    if (!this._isAllowed(chatId)) return null;

    // Avoid node-telegram-bot-api Buffer deprecation warnings:
    // - provide filename
    // - provide explicit contentType for PNG buffers
    if (Buffer.isBuffer(buffer)) {
      return this.bot.sendPhoto(chatId, buffer, options, { filename: "chart.png", contentType: "image/png" });
    }
    return this.bot.sendPhoto(chatId, buffer, options);
  }
}
