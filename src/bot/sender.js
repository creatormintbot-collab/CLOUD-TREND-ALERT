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

  // Reply helper used by monitor/lifecycle flows.
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

    // Always pass filename + contentType to avoid node-telegram-bot-api deprecation warnings.
    // Also normalize common binary types (Uint8Array / ArrayBuffer / wrapper objects).
    const fileOptions = { filename: "chart.png", contentType: "image/png" };

    let photo = buffer;
    if (photo && typeof photo === "object" && !Buffer.isBuffer(photo)) {
      // Some renderers may wrap the buffer (e.g., { data }, { buffer }, { source }).
      if (photo.source) photo = photo.source;
      else if (photo.buffer) photo = photo.buffer;
      else if (photo.data) photo = photo.data;
    }

    if (Buffer.isBuffer(photo)) {
      return this.bot.sendPhoto(chatId, photo, options, fileOptions);
    }
    if (photo instanceof Uint8Array) {
      return this.bot.sendPhoto(chatId, Buffer.from(photo), options, fileOptions);
    }
    if (photo instanceof ArrayBuffer) {
      return this.bot.sendPhoto(chatId, Buffer.from(new Uint8Array(photo)), options, fileOptions);
    }

    // Fallback (string file_id/path or stream). Keep fileOptions to be explicit.
    return this.bot.sendPhoto(chatId, photo, options, fileOptions);
  }
}