import { sleep } from "../utils/sleep.js";

export class ProgressUi {
  constructor({ sender }) {
    this.sender = sender;
    this.locks = new Map();     // key -> boolean
    this.lastAt = new Map();    // key -> ms
    this.THROTTLE_MS = 7000;    // hard throttle to reduce spam
    this.TIMEOUT_MS = 60000;   // /scan hard timeout (ms)
    this.STEP_DELAY_MS = 200;  // UI delay per step (ms)
  }

  _key(chatId, userId) {
    const c = String(chatId);
    const u = String(userId ?? "0");
    return `${c}:${u}`;
  }

  locked(key) { return this.locks.get(String(key)) === true; }
  lock(key) { this.locks.set(String(key), true); }
  unlock(key) { this.locks.delete(String(key)); }

  async run({ chatId, userId }, fn) {
    const key = this._key(chatId, userId);

    // throttle
    const now = Date.now();
    const last = Number(this.lastAt.get(key) || 0);
    if (last && (now - last) < this.THROTTLE_MS) {
      const waitSec = Math.ceil((this.THROTTLE_MS - (now - last)) / 1000);
      await this.sender.sendText(chatId, `⏳ Too many requests. Please wait ${waitSec}s and try again…`);
      return { kind: "THROTTLED", elapsedMs: 0, result: null, messageId: null };
    }
    this.lastAt.set(key, now);

    // lock
    if (this.locked(key)) {
      await this.sender.sendText(chatId, "⏳ Scan in progress, please wait…");
      return { kind: "LOCKED", elapsedMs: 0, result: null, messageId: null };
    }

    this.lock(key);
    const started = Date.now();
    let msg = null;

    const elapsed = () => Date.now() - started;

    try {
      msg = await this.sender.sendText(chatId, "🧠 Booting AI Core… 0%");
      await sleep(this.STEP_DELAY_MS);

      await this.sender.editText(chatId, msg.message_id, "🔎 Finding the best setup… 50%");
      await sleep(this.STEP_DELAY_MS);

      // LOCKED: no double 90%
      await this.sender.editText(chatId, msg.message_id, "🤖 Finalizing data… 90%");
      await sleep(this.STEP_DELAY_MS);

      if (elapsed() > this.TIMEOUT_MS) {
        await this.sender.editText(chatId, msg.message_id, "⚠️ Scan timeout. Please try again.");
        return { kind: "TIMEOUT", elapsedMs: elapsed(), result: null, messageId: msg?.message_id || null };
      }

      const res = await fn();

      if (elapsed() > this.TIMEOUT_MS) {
        await this.sender.editText(chatId, msg.message_id, "⚠️ Scan timeout. Please try again.");
        return { kind: "TIMEOUT", elapsedMs: elapsed(), result: null, messageId: msg?.message_id || null };
      }

      if (!res) {
        await this.sender.editText(chatId, msg.message_id, "⚠️ No valid setup found. Details will be shown below.");
        return { kind: "NO_SIGNAL", elapsedMs: elapsed(), result: null, messageId: msg?.message_id || null };
      }

      await this.sender.editText(chatId, msg.message_id, "✅ AI Futures Signal Generated! 100%");
      return { kind: "OK", elapsedMs: elapsed(), result: res, messageId: msg?.message_id || null };
    } catch (e) {
      if (msg?.message_id) {
        await this.sender.editText(chatId, msg.message_id, "⚠️ Scan failed. Try again later.");
      }
      return { kind: "ERROR", elapsedMs: elapsed(), result: null, messageId: msg?.message_id || null, error: e };
    } finally {
      this.unlock(key);
    }
  }
}
