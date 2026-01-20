export class Sender {
  constructor({ bot, allowedGroupIds = [] } = {}) {
    this.bot = bot;
    this.allowed = new Set((allowedGroupIds || []).map(String));

    // Small, safe default retry policy for Telegram flood control & transient network.
    this._maxAttempts = 3;
  }

  _isAllowed(chatId) {
    const id = String(chatId);
    // if allowed list empty -> allow all (dev mode)
    if (this.allowed.size === 0) return true;
    return this.allowed.has(id);
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  _getRetryAfterMs(err) {
    // node-telegram-bot-api error shape varies; handle the common ones.
    const body = err?.response?.body;
    const params = body?.parameters;
    const retryAfterSec = Number(params?.retry_after ?? body?.retry_after);
    if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) return Math.min(15_000, Math.ceil(retryAfterSec * 1000));

    // Some environments expose headers
    const raHeader = err?.response?.headers?.["retry-after"];
    const raHeaderSec = Number(raHeader);
    if (Number.isFinite(raHeaderSec) && raHeaderSec > 0) return Math.min(15_000, Math.ceil(raHeaderSec * 1000));

    return null;
  }

  _isRetryable(err) {
    const code = err?.code;
    const status = err?.response?.statusCode ?? err?.response?.status;

    // Telegram flood control
    if (status === 429) return true;

    // transient infra
    if (status >= 500 && status <= 599) return true;

    // common network errors
    if (
      code === "ETIMEDOUT" ||
      code === "ECONNRESET" ||
      code === "EAI_AGAIN" ||
      code === "ENOTFOUND" ||
      code === "ECONNREFUSED"
    ) {
      return true;
    }

    return false;
  }

  async _callWithRetry(fn) {
    let attempt = 0;
    // base jittered backoff
    let backoffMs = 500;

    while (attempt < this._maxAttempts) {
      try {
        return await fn();
      } catch (err) {
        attempt += 1;

        if (!this._isRetryable(err) || attempt >= this._maxAttempts) {
          // IMPORTANT: never throw here (avoid breaking /scan mid-stream)
          return null;
        }

        const retryAfterMs = this._getRetryAfterMs(err);
        const waitMs = retryAfterMs ?? backoffMs;
        await this._sleep(waitMs);

        // exponential backoff w/ cap
        backoffMs = Math.min(10_000, Math.floor(backoffMs * 1.8));
      }
    }

    return null;
  }

  async sendText(chatId, text) {
    if (!this._isAllowed(chatId)) return null;
    return this._callWithRetry(() => this.bot.sendMessage(chatId, text, { disable_web_page_preview: true }));
  }

  async editText(chatId, messageId, text) {
    if (!this._isAllowed(chatId)) return null;
    return this._callWithRetry(() =>
      this.bot.editMessageText(text, { chat_id: chatId, message_id: messageId, disable_web_page_preview: true })
    );
  }

  async sendPhoto(chatId, buffer) {
    if (!this._isAllowed(chatId)) return null;
    return this._callWithRetry(() => this.bot.sendPhoto(chatId, buffer));
  }
}