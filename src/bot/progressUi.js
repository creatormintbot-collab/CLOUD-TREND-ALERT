import { sleep } from "../utils/sleep.js";

export class ProgressUi {
  constructor({ sender }) {
    this.sender = sender;
    this.locks = new Map();     // key -> boolean
    this.lastAt = new Map();    // key -> ms
    this.THROTTLE_MS = 7000;    // hard throttle to reduce spam

    // Batch /scan can take longer than single-pair rotation.
    this.TIMEOUT_MS = 60_000;
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
      return { kind: "THROTTLED", elapsedMs: 0, result: null };
    }
    this.lastAt.set(key, now);

    // lock
    if (this.locked(key)) {
      await this.sender.sendText(chatId, "⏳ Scan in progress, please wait…");
      return { kind: "LOCKED", elapsedMs: 0, result: null };
    }

    this.lock(key);
    const started = Date.now();
    let msg = null;

    const elapsed = () => Date.now() - started;

    try {
      msg = await this.sender.sendText(chatId, "🧠 Booting AI Core… 0%");
      await sleep(1000);

      await this.sender.editText(chatId, msg.message_id, "🔎 Finding the best setup… 50%");
      await sleep(1000);

      // LOCKED: no double 90%
      await this.sender.editText(chatId, msg.message_id, "🤖 Finalizing data… 90%");
      await sleep(1000);

      if (elapsed() > this.TIMEOUT_MS) {
        await this.sender.editText(chatId, msg.message_id, "⚠️ Scan timeout. Please try again.");
        return { kind: "TIMEOUT", elapsedMs: elapsed(), result: null };
      }

      const res = await fn();

      if (elapsed() > this.TIMEOUT_MS) {
        await this.sender.editText(chatId, msg.message_id, "⚠️ Scan timeout. Please try again.");
        return { kind: "TIMEOUT", elapsedMs: elapsed(), result: null };
      }

      const empty =
        (res == null) ||
        (Array.isArray(res) && res.length === 0) ||
        (res && typeof res === "object" && Array.isArray(res.results) && res.results.length === 0);

      if (empty) {
        await this.sender.editText(chatId, msg.message_id, "⚠️ No valid setup found. Try again later.");
        return { kind: "NO_SIGNAL", elapsedMs: elapsed(), result: null };
      }

      await this.sender.editText(chatId, msg.message_id, "✅ Scan Completed! 100%");
      return { kind: "OK", elapsedMs: elapsed(), result: res };
    } catch {
      if (msg?.message_id) {
        await this.sender.editText(chatId, msg.message_id, "⚠️ Scan timeout. Please try again.");
      }
      return { kind: "TIMEOUT", elapsedMs: elapsed(), result: null };
    } finally {
      this.unlock(key);
    }
  }
}