export class CandleStore {
  constructor({ limit = 600, logger }) {
    this.limit = Number(limit) || 600;
    this.log = logger;
    // key: `${symbol}:${tf}` => candles[]
    this.map = new Map();
    // shared empty (avoid allocations)
    this._empty = [];
  }

  key(symbol, tf) {
    return `${symbol}:${tf}`;
  }

  get(symbol, tf) {
    return this.map.get(this.key(symbol, tf)) ?? this._empty;
  }

  set(symbol, tf, candles) {
    const k = this.key(symbol, tf);
    if (!Array.isArray(candles)) {
      this.map.set(k, this._empty);
      return;
    }

    // Defensive log if backfill returns abnormal size (can cause huge peak memory)
    if (candles.length > this.limit * 20) {
      this.log?.warn?.(
        { symbol, tf, len: candles.length, limit: this.limit },
        "CandleStore.set received unusually large candles array"
      );
    }

    // Keep only tail (bounded)
    const trimmed = candles.slice(-this.limit);
    this.map.set(k, trimmed);
  }

  upsert(symbol, tf, candle) {
    const k = this.key(symbol, tf);
    const arr = this.map.get(k) ?? [];

    if (arr.length && arr[arr.length - 1].openTime === candle.openTime) {
      arr[arr.length - 1] = candle;
    } else {
      arr.push(candle);
      // Trim in-place when possible (reduce temporary arrays)
      if (arr.length > this.limit) {
        arr.splice(0, arr.length - this.limit);
      }
    }

    this.map.set(k, arr);
  }

  hasMin(symbol, tf, n = 300) {
    return this.get(symbol, tf).length >= n;
  }

  // Optional debug helper
  stats() {
    let keys = 0;
    let total = 0;
    for (const v of this.map.values()) {
      keys++;
      total += v?.length ?? 0;
    }
    return { keys, totalCandles: total, limit: this.limit };
  }
}
