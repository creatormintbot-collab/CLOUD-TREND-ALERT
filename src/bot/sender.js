export class Sender {
  constructor({ bot, allowedGroupIds = [] } = {}) {
    this.bot = bot;
    this.allowed = new Set((allowedGroupIds || []).map(String));
  }

  _isAllowed(chatId) {
    const id = String(chatId);
    // If allowed list is empty -> allow all (dev mode).
    if (this.allowed.size === 0) return true;
    return this.allowed.has(id);
  }

  async sendText(chatId, text, options = {}) {
    if (!this._isAllowed(chatId)) return null;
    return this.bot.sendMessage(chatId, text, { disable_web_page_preview: true, ...options });
  }

  async sendTextReply(chatId, replyToMessageId, text, options = {}) {
    const replyOpts = replyToMessageId
      ? { reply_to_message_id: replyToMessageId, allow_sending_without_reply: true }
      : {};
    return this.sendText(chatId, text, { ...replyOpts, ...options });
  }

  async editText(chatId, messageId, text, options = {}) {
    if (!this._isAllowed(chatId)) return null;
    return this.bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      disable_web_page_preview: true,
      ...options
    });
  }

  async sendPhoto(chatId, buffer, options = {}) {
    if (!this._isAllowed(chatId)) return null;
    return this.bot.sendPhoto(chatId, buffer, options);
  }

  async sendPhotoReply(chatId, replyToMessageId, buffer, options = {}) {
    const replyOpts = replyToMessageId
      ? { reply_to_message_id: replyToMessageId, allow_sending_without_reply: true }
      : {};
    return this.sendPhoto(chatId, buffer, { ...replyOpts, ...options });
  }
}
