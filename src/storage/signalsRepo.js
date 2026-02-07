import path from "node:path";
import { SIGNALS_DIR } from "../config/constants.js";
import { utcDateKey } from "../utils/time.js";

function prevUtcDayKey(dayKey) {
  try {
    const d = new Date(`${dayKey}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return utcDateKey(d);
  } catch {
    // fallback: yesterday from now
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return utcDateKey(d);
  }
}


function derivePlaybookFromTf(tf) {
  const t = String(tf || "").toLowerCase();
  return t === "4h" ? "SWING" : "INTRADAY";
}
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
        playbook: signal.playbook || derivePlaybookFromTf(signal.tf),
        confluence: signal.confluence || null,
        confluenceTfs: Array.isArray(signal.confluenceTfs) ? signal.confluenceTfs : null,
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
        playbook: pos.playbook || derivePlaybookFromTf(pos.tf),
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

  // ---- helpers (non-breaking) ----
  async readDay(dayKey) {
    const file = path.join(SIGNALS_DIR, `signals-${dayKey}.json`);
    const data = await readJson(file, { dateUTC: dayKey, events: [] });
    if (!data?.events) return { dateUTC: dayKey, events: [] };
    return data;
  }

  async hasRecentEntry({ symbol, tf, withinMs = 0, nowMs = null }) {
    const s = String(symbol || "").toUpperCase();
    const t = String(tf || "").toLowerCase();
    const ms = Number(withinMs || 0);
    const now = Number(nowMs ?? Date.now());
    if (!s || !t || !Number.isFinite(ms) || ms <= 0) return false;

    const todayKey = utcDateKey(new Date(now));
    const prevKey = prevUtcDayKey(todayKey);

    const [today, prev] = await Promise.all([this.readDay(todayKey), this.readDay(prevKey)]);
    const events = [...(prev?.events || []), ...(today?.events || [])];

    const cutoff = now - ms;

    for (const ev of events) {
      if (!ev || ev.type !== "ENTRY") continue;
      if (String(ev.symbol || "").toUpperCase() !== s) continue;
      if (String(ev.tf || "").toLowerCase() !== t) continue;

      const ts = Date.parse(ev.ts || "");
      if (Number.isFinite(ts) && ts >= cutoff) return true;
    }
    return false;
  }

  async getDayStats(dayKeyOrOpts) {
    let dayKey = dayKeyOrOpts;
    let scopeId = null;
    if (dayKeyOrOpts && typeof dayKeyOrOpts === "object") {
      dayKey = dayKeyOrOpts.dayKey;
      scopeId = dayKeyOrOpts.scopeId ?? null;
    }
    const data = await this.readDay(dayKey);
    const eventsRaw = Array.isArray(data?.events) ? data.events : [];
    const events = scopeId
      ? eventsRaw.filter((ev) => String(ev?.scopeId ?? ev?.meta?.scopeId || "") === String(scopeId))
      : eventsRaw;

    const stats = {
      dateKey: dayKey,
      autoSignalsSent: 0,
      // scanRequests = total attempts (including throttled/timeout) for backward compatibility
      scanRequests: 0,
      // success attempts only (ENTRY from SCAN + SCAN_NO_SIGNAL)
      scanRequestsSuccess: 0,
      // failed attempts (e.g. TIMEOUT)
      scanRequestsFailed: 0,
      // blocked attempts (e.g. cooldown throttled)
      scanRequestsThrottled: 0,
      scanSignalsSent: 0,
      totalSignalsSent: 0,
      tfBreakdownSent: { "15m": 0, "30m": 0, "1h": 0, "4h": 0 },
      playbookBreakdownSent: { INTRADAY: 0, SWING: 0 },
      // optional breakdowns (non-breaking)
      scanNoSignal: 0,
      scanTimeout: 0,
      scanThrottled: 0,
    };

    for (const ev of events) {
      if (!ev) continue;

      if (ev.type === "ENTRY") {
        const src = String(ev.source || "").toUpperCase();
        if (src === "AUTO") stats.autoSignalsSent++;
        if (src === "SCAN") {
          stats.scanSignalsSent++;
          stats.scanRequests++; // a successful /scan is still a request
          stats.scanRequestsSuccess++;
        }

        const tf = String(ev.tf || "").toLowerCase();
        if (stats.tfBreakdownSent[tf] !== undefined) stats.tfBreakdownSent[tf]++;
        const pb = String(ev.playbook || "").toUpperCase();
        if (stats.playbookBreakdownSent[pb] !== undefined) stats.playbookBreakdownSent[pb]++;
        stats.totalSignalsSent++;
        continue;
      }

      // Count /scan attempts that didn't produce a signal.
      if (ev.type === "SCAN_NO_SIGNAL") {
        stats.scanRequests++;
        stats.scanRequestsSuccess++;
        stats.scanNoSignal++;
        continue;
      }

      if (ev.type === "SCAN_TIMEOUT") {
        stats.scanRequests++;
        stats.scanRequestsFailed++;
        stats.scanTimeout++;
        continue;
      }

      if (ev.type === "SCAN_THROTTLED") {
        stats.scanRequests++;
        stats.scanRequestsThrottled++;
        stats.scanThrottled++;
        continue;
      }
    }

    return stats;
  }

  // Count ENTRY events by source for a given UTC day.
  async getEntryCountsBySource(dayKey) {
    const data = await this.readDay(dayKey);
    const events = Array.isArray(data?.events) ? data.events : [];

    const bySource = {};
    let total = 0;

    for (const ev of events) {
      if (!ev || ev.type !== "ENTRY") continue;
      const src = String(ev.source || "").toUpperCase() || "UNKNOWN";
      bySource[src] = (bySource[src] || 0) + 1;
      total += 1;
    }

    return { dateKey: dayKey, total, bySource };
  }

  async flush() {
    await this._queue;
  }
}
