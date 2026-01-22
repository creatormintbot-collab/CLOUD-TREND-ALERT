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

  _normalizeOptions(opts = {}) {
    const o = { ...(opts || {}) };

    if (o.threadId != null && o.message_thread_id == null) {
      o.message_thread_id = o.threadId;
      delete o.threadId;
    }

    if (o.replyToMessageId != null && o.reply_to_message_id == null) {
      o.reply_to_message_id = o.replyToMessageId;
      delete o.replyToMessageId;
    }

    return o;
  }

  async sendText(chatId, text, opts = {}) {
    if (!this._isAllowed(chatId)) return null;
    const o = this._normalizeOptions(opts);
    return this.bot.sendMessage(chatId, text, { disable_web_page_preview: true, ...o });
  }

  async editText(chatId, messageId, text, opts = {}) {
    if (!this._isAllowed(chatId)) return null;
    const o = this._normalizeOptions(opts);
    return this.bot.editMessageText(text, { chat_id: chatId, message_id: messageId, disable_web_page_preview: true, ...o });
  }

  async sendPhoto(chatId, buffer, opts = {}) {
    if (!this._isAllowed(chatId)) return null;
    const o = this._normalizeOptions(opts);
    return this.bot.sendPhoto(chatId, buffer, { ...o });
  }
}
