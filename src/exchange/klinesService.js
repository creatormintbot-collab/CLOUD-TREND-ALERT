import { normalizeInterval, intervalToMs } from "./intervals.js";

function keyOf(symbol, tf) { return `${symbol}|${tf}`; }
function toNum(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }
function nowMs() { return Date.now(); }

function parseRestKlineRow(row) {
  return {
    openTime: Number(row[0]),
    closeTime: Number(row[6]),
    open: toNum(row[1]),
    high: toNum(row[2]),
    low: toNum(row[3]),
    close: toNum(row[4]),
    volume: toNum(row[5]),
    isFinal: true
  };
}

function isClosedByTime(c, tfMs) { return nowMs() >= (c.openTime + tfMs); }

function dedupeSortLimit(candles, maxCandles) {
  const map = new Map();
  for (const c of candles) map.set(c.closeTime, c);
  const arr = Array.from(map.values()).sort((a, b) => a.closeTime - b.closeTime);
  return arr.length > maxCandles ? arr.slice(-maxCandles) : arr;
}

export class KlinesService {
  constructor({ rest, wsManager, backfillLimit = 300, maxCandles = 800, klinesRepo = null, logger } = {}) {
    this.rest = rest;
    this.ws = wsManager;
    this.backfillLimit = Number(backfillLimit || 300);
    this.maxCandles = Number(maxCandles || 800);
    this.klinesRepo = klinesRepo || null;
    this.logger = logger || console;

    this._store = new Map();      // key -> candles[]
    this._lastClosed = new Map(); // key -> last closeTime
    this._tfLast = new Map();     // tf -> max closeTime among all symbols
    this._patchLocks = new Map();

    if (this.ws) this.ws.setHandler((msg) => this._onWsMessage(msg));
  }

  getCandles(symbol, tf) {
    const s = String(symbol).toUpperCase();
    const t = normalizeInterval(tf);
    return this._store.get(keyOf(s, t)) || [];
  }

  lastClosedTime(tf) {
    const t = normalizeInterval(tf);
    return this._tfLast.get(t) || 0;
  }

  _setCandles(symbol, tf, candles, { persist = true } = {}) {
    const k = keyOf(symbol, tf);
    const arr = dedupeSortLimit(candles, this.maxCandles);
    this._store.set(k, arr);

    const last = arr.length ? arr[arr.length - 1].closeTime : 0;
    this._lastClosed.set(k, last);

    const cur = this._tfLast.get(tf) || 0;
    if (last > cur) this._tfLast.set(tf, last);

    if (persist && this.klinesRepo) this.klinesRepo.markDirty(symbol, tf);
  }

  setCached(symbol, tf, candles) {
    const s = String(symbol).toUpperCase();
    const t = normalizeInterval(tf);
    this._setCandles(s, t, candles, { persist: false });
  }

  async loadFromRepo(symbols, tfs) {
    if (!this.klinesRepo) return;
    const symList = (symbols || []).map((x) => String(x).toUpperCase());
    const tfList = (tfs || []).map(normalizeInterval);

    for (const symbol of symList) {
      for (const tf of tfList) {
        try {
          const cached = await this.klinesRepo.load(symbol, tf);
          if (Array.isArray(cached) && cached.length) {
            this.setCached(symbol, tf, cached);
          }
        } catch {
          // ignore
        }
      }
    }
  }

  async backfill(symbols, tfs) {
    const symList = (symbols || []).map((x) => String(x).toUpperCase());
    const tfList = (tfs || []).map(normalizeInterval);

    for (const symbol of symList) {
      for (const tf of tfList) {
        try {
          const tfMs = intervalToMs(tf);
          const existing = this.getCandles(symbol, tf);
          const lastClose = existing.length ? existing[existing.length - 1].closeTime : 0;

          // SMART sync:
          // - If cache already has >= backfillLimit, do light sync (overlap window) to avoid REST burst.
          // - Else do full backfillLimit.
          let rows = null;

          if (existing.length >= this.backfillLimit && lastClose) {
            const overlap = tfMs * 120; // overlap window
            const startTime = Math.max(0, Number(lastClose) - overlap);
            rows = await this.rest.klines({ symbol, interval: tf, startTime, limit: 200 });
          } else {
            rows = await this.rest.klines({ symbol, interval: tf, limit: this.backfillLimit });
          }

          const parsed = (rows || [])
            .map(parseRestKlineRow)
            .filter((c) => isClosedByTime(c, tfMs));

          this._setCandles(symbol, tf, [...existing, ...parsed], { persist: true });
        } catch (e) {
          this.logger?.warn?.(`[klines] backfill failed ${symbol} ${tf}: ${e?.message || e}`);
          this._setCandles(symbol, tf, this.getCandles(symbol, tf), { persist: false });
        }
      }
    }
  }

  async subscribe(symbols, tfs) {
    if (!this.ws) return;
    const symList = (symbols || []).map((x) => String(x).toUpperCase());
    const tfList = (tfs || []).map(normalizeInterval);

    const streams = [];
    for (const s of symList) for (const tf of tfList) streams.push(`${s.toLowerCase()}@kline_${tf}`);
    await this.ws.setStreams(streams);
  }

  async _onWsMessage(msg) {
    const data = msg?.data;
    if (!data || data.e !== "kline") return;
    const k = data.k;
    if (!k || !k.x) return; // only closed candle

    const symbol = String(k.s || "").toUpperCase();
    const tf = normalizeInterval(k.i);
    if (!symbol || !tf) return;

    const candle = {
      openTime: Number(k.t),
      closeTime: Number(k.T),
      open: toNum(k.o),
      high: toNum(k.h),
      low: toNum(k.l),
      close: toNum(k.c),
      volume: toNum(k.v),
      isFinal: true
    };

    await this._handleFinal(symbol, tf, candle);
  }

  async _handleFinal(symbol, tf, candle) {
    const k = keyOf(symbol, tf);
    const tfMs = intervalToMs(tf);

    const current = this._store.get(k) || [];
    const lastClose = this._lastClosed.get(k) || (current.length ? current[current.length - 1].closeTime : 0);

    if (lastClose && candle.closeTime <= lastClose) {
      this._setCandles(symbol, tf, [...current, candle], { persist: true });
      return;
    }

    const expected = lastClose ? (lastClose + tfMs) : 0;
    const gap = lastClose && candle.closeTime > expected;

    if (gap) {
      const missingCount = Math.max(0, Math.round((candle.closeTime - lastClose) / tfMs) - 1);
      await this._patchGap(symbol, tf, lastClose, candle.closeTime, missingCount);
    }

    this._setCandles(symbol, tf, [...(this._store.get(k) || []), candle], { persist: true });
  }

  async _patchGap(symbol, tf, lastCloseTime, incomingCloseTime, missingCount) {
    if (missingCount <= 0) return;
    const k = keyOf(symbol, tf);

    const prev = this._patchLocks.get(k) || Promise.resolve();
    const task = prev.then(async () => {
      try {
        const startTime = Number(lastCloseTime) + 1;
        const endTime = Number(incomingCloseTime);
        const limit = Math.min(1500, missingCount + 10);

        const rows = await this.rest.klines({ symbol, interval: tf, startTime, endTime, limit });
        const tfMs = intervalToMs(tf);

        const patched = (rows || [])
          .map(parseRestKlineRow)
          .filter((c) => isClosedByTime(c, tfMs));

        if (patched.length) {
          const cur = this._store.get(k) || [];
          this._setCandles(symbol, tf, [...cur, ...patched], { persist: true });
          this.logger?.warn?.(`[klines] gap patched ${symbol} ${tf} missing=${missingCount} patched=${patched.length}`);
        }
      } catch (e) {
        this.logger?.warn?.(`[klines] gap patch failed ${symbol} ${tf}: ${e?.message || e}`);
      }
    });

    this._patchLocks.set(k, task.finally(() => {
      if (this._patchLocks.get(k) === task) this._patchLocks.delete(k);
    }));

    return task;
  }
}