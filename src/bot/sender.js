import { createHash } from "node:crypto";

export class Sender {
  constructor({ bot, allowedGroupIds = [] } = {}) {
    this.bot = bot;
    this.allowed = new Set((allowedGroupIds || []).map(String));

    // Small, safe default retry policy for Telegram flood control & transient network.
    this._maxAttempts = 3;

    // Defensive anti-duplicate for bursty /scan sends and ambiguous network retries.
    // Short-lived cache keyed by: chatId|kind|payloadHash
    this._dedupeWindowMs = 10_000;
    this._recent = new Map();
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

  _hashText(text) {
    const s = text == null ? "" : String(text);
    return createHash("sha1").update(s).digest("hex");
  }

  _hashBuffer(buffer) {
    if (!buffer) return "";
    return createHash("sha1").update(buffer).digest("hex");
  }

  _cleanupRecent(now) {
    // keep a little longer than the window to avoid unbounded growth
    const cutoff = now - Math.max(30_000, this._dedupeWindowMs * 2);
    for (const [k, ts] of this._recent) {
      if (ts < cutoff) this._recent.delete(k);
    }
  }

  _shouldSend(kind, chatId, payloadHash, now = Date.now()) {
    this._cleanupRecent(now);
    const key = `${String(chatId)}|${kind}|${payloadHash}`;
    const prev = this._recent.get(key);
    if (prev != null && now - prev <= this._dedupeWindowMs) return false;
    this._recent.set(key, now);
    return true;
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

  _isRetryable(err, op = "generic") {
    const code = err?.code;
    const status = err?.response?.statusCode ?? err?.response?.status;

    // Telegram flood control
    if (status === 429) return true;

    // transient infra
    if (status >= 500 && status <= 599) return true;

    // common network errors
    // NOTE: For send operations, ETIMEDOUT/ECONNRESET can be ambiguous (request may have been delivered).
    // To reduce duplicate messages, we do not retry those two for op === "send".
    if (
      code === "EAI_AGAIN" ||
      code === "ENOTFOUND" ||
      code === "ECONNREFUSED" ||
      (op !== "send" && (code === "ETIMEDOUT" || code === "ECONNRESET"))
    ) {
      return true;
    }

    return false;
  }

  async _callWithRetry(fn, { op = "generic" } = {}) {
    let attempt = 0;
    // base jittered backoff
    let backoffMs = 500;

    while (attempt < this._maxAttempts) {
      try {
        return await fn();
      } catch (err) {
        attempt += 1;

        if (!this._isRetryable(err, op) || attempt >= this._maxAttempts) {
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

    // Deduplicate identical payloads in a short time window.
    // This prevents repeated /scan results from being sent multiple times if upstream emits duplicates.
    const hash = this._hashText(text);
    if (!this._shouldSend("text", chatId, hash)) return null;

    return this._callWithRetry(() => this.bot.sendMessage(chatId, text, { disable_web_page_preview: true }), { op: "send" });
  }

  async editText(chatId, messageId, text) {
    if (!this._isAllowed(chatId)) return null;
    return this._callWithRetry(
      () => this.bot.editMessageText(text, { chat_id: chatId, message_id: messageId, disable_web_page_preview: true }),
      { op: "edit" }
    );
  }

  async sendPhoto(chatId, buffer) {
    if (!this._isAllowed(chatId)) return null;

    const hash = this._hashBuffer(buffer);
    if (!this._shouldSend("photo", chatId, hash)) return null;

    return this._callWithRetry(() => this.bot.sendPhoto(chatId, buffer), { op: "send" });
  }
}