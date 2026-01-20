import path from "node:path";
import { SIGNALS_DIR } from "../config/constants.js";
import { utcDateKey } from "../utils/time.js";
import { readJson, writeJsonAtomic } from "./jsonStore.js";

export class SignalsRepo {
  constructor() {
    this.dayKey = utcDateKey();
    this.file = path.join(SIGNALS_DIR, `signals-${this.dayKey}.json`);
    this.data = { dateUTC: this.dayKey, events: [] };
    this._loaded = false;
    this._queue = Promise.resolve();
  }

  async _ensureLoaded(dayKey) {
    if (this._loaded && this.dayKey === dayKey) return;

    this.dayKey = dayKey;
    this.file = path.join(SIGNALS_DIR, `signals-${this.dayKey}.json`);
    this.data = await readJson(this.file, { dateUTC: this.dayKey, events: [] });
    if (!this.data?.events) this.data = { dateUTC: this.dayKey, events: [] };

    this._loaded = true;
  }

  _eventBase(source, meta) {
    const now = new Date();
    return {
      ts: now.toISOString(),
      dayUTC: utcDateKey(now),
      source,
      ...(meta || {})
    };
  }

  _pushAndPersist(ev) {
    this.data.events.push(ev);
    if (this.data.events.length > 8000) this.data.events = this.data.events.slice(-8000);
    return writeJsonAtomic(this.file, this.data);
  }

  async logEntry({ source, signal, meta }) {
    this._queue = this._queue.then(async () => {
      const dayKey = utcDateKey();
      await this._ensureLoaded(dayKey);

      const ev = {
        ...this._eventBase(source, meta),
        type: "ENTRY",
        symbol: signal.symbol,
        tf: signal.tf,
        direction: signal.direction,
        score: Math.round(signal.score || 0),
        scoreLabel: signal.scoreLabel || "",
        candleCloseTime: signal.candleCloseTime,
        macro: signal.macro || {},
        points: signal.points || {},
        levels: {
          entryLow: signal.levels?.entryLow,
          entryHigh: signal.levels?.entryHigh,
          entryMid: signal.levels?.entryMid,
          sl: signal.levels?.sl,
          tp1: signal.levels?.tp1,
          tp2: signal.levels?.tp2,
          tp3: signal.levels?.tp3
        }
      };

      await this._pushAndPersist(ev);
    });

    return this._queue;
  }

  async logLifecycle({ source, pos, event, price, meta }) {
    this._queue = this._queue.then(async () => {
      const dayKey = utcDateKey();
      await this._ensureLoaded(dayKey);

      const ev = {
        ...this._eventBase(source, meta),
        type: "LIFECYCLE",
        event,
        positionId: pos.id,
        symbol: pos.symbol,
        tf: pos.tf,
        direction: pos.direction,
        price: Number(price ?? 0),
        hit: { tp1: !!pos.hitTP1, tp2: !!pos.hitTP2, tp3: !!pos.hitTP3 },
        status: pos.status,
        closeOutcome: pos.closeOutcome || null,
        closedAt: pos.closedAt || null,
        sl: { initial: pos.slInitial, current: pos.slCurrent, mode: pos.slMode },
        levels: {
          entryMid: pos.levels?.entryMid,
          sl: pos.levels?.sl,
          tp1: pos.levels?.tp1,
          tp2: pos.levels?.tp2,
          tp3: pos.levels?.tp3
        }
      };

      await this._pushAndPersist(ev);
    });

    return this._queue;
  }

  async logScanNoSignal({ chatId, query, elapsedMs, meta }) {
    this._queue = this._queue.then(async () => {
      const dayKey = utcDateKey();
      await this._ensureLoaded(dayKey);

      const ev = {
        ...this._eventBase("SCAN", { chatId: String(chatId), ...(meta || {}) }),
        type: "SCAN_NO_SIGNAL",
        query: {
          symbol: query?.symbol ? String(query.symbol).toUpperCase() : null,
          tf: query?.tf ? String(query.tf) : null,
          raw: query?.raw || ""
        },
        elapsedMs: Number(elapsedMs || 0)
      };

      await this._pushAndPersist(ev);
    });

    return this._queue;
  }

  async logScanTimeout({ chatId, query, elapsedMs, meta }) {
    this._queue = this._queue.then(async () => {
      const dayKey = utcDateKey();
      await this._ensureLoaded(dayKey);

      const ev = {
        ...this._eventBase("SCAN", { chatId: String(chatId), ...(meta || {}) }),
        type: "SCAN_TIMEOUT",
        query: {
          symbol: query?.symbol ? String(query.symbol).toUpperCase() : null,
          tf: query?.tf ? String(query.tf) : null,
          raw: query?.raw || ""
        },
        elapsedMs: Number(elapsedMs || 0)
      };

      await this._pushAndPersist(ev);
    });

    return this._queue;
  }

  async logScanThrottled({ chatId, query, meta }) {
    this._queue = this._queue.then(async () => {
      const dayKey = utcDateKey();
      await this._ensureLoaded(dayKey);

      const ev = {
        ...this._eventBase("SCAN", { chatId: String(chatId), ...(meta || {}) }),
        type: "SCAN_THROTTLED",
        query: {
          symbol: query?.symbol ? String(query.symbol).toUpperCase() : null,
          tf: query?.tf ? String(query.tf) : null,
          raw: query?.raw || ""
        }
      };

      await this._pushAndPersist(ev);
    });

    return this._queue;
  }

  async flush() {
    await this._queue;
  }
}
