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

  async editText(chatId, messageId, text) {
    if (!this._isAllowed(chatId)) return null;
    return this.bot.editMessageText(text, { chat_id: chatId, message_id: messageId, disable_web_page_preview: true });
  }

  async sendPhoto(chatId, buffer, options = {}) {
    if (!this._isAllowed(chatId)) return null;

    // Avoid node-telegram-bot-api Buffer filename deprecation warning.
    if (Buffer.isBuffer(buffer)) {
      return this.bot.sendPhoto(chatId, buffer, options, { filename: "chart.png" });
    }
    return this.bot.sendPhoto(chatId, buffer, options);
  }
}