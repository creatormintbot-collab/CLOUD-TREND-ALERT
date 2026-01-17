export class CandleStore {
  constructor({ limit = 600, logger }) {
    this.limit = limit;
    this.log = logger;
    // key: `${symbol}:${tf}` => candles[]
    this.map = new Map();
  }

  key(symbol, tf) {
    return `${symbol}:${tf}`;
  }

  get(symbol, tf) {
    return this.map.get(this.key(symbol, tf)) ?? [];
  }

  set(symbol, tf, candles) {
    const trimmed = candles.slice(-this.limit);
    this.map.set(this.key(symbol, tf), trimmed);
  }

  upsert(symbol, tf, candle) {
    const k = this.key(symbol, tf);
    const arr = this.map.get(k) ?? [];
    if (arr.length && arr[arr.length - 1].openTime === candle.openTime) {
      arr[arr.length - 1] = candle;
    } else {
      arr.push(candle);
    }
    this.map.set(k, arr.slice(-this.limit));
  }

  hasMin(symbol, tf, n = 300) {
    return this.get(symbol, tf).length >= n;
  }
}
