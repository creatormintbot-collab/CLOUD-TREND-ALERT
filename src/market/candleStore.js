import { TF_TO_MINUTES } from "../config/constants.js";

function klineToCandle(k) {
  return {
    openTime: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closeTime: Number(k[6]),
  };
}

export function createCandleStore() {
  // store[symbol][tf] = candles[]
  const store = new Map();
  const listeners = new Set();

  function key(symbol, tf) {
    return `${symbol}__${tf}`;
  }

  function get(symbol, tf) {
    return store.get(key(symbol, tf)) || [];
  }

  function set(symbol, tf, candles) {
    store.set(key(symbol, tf), candles);
  }

  function appendOrUpdate(symbol, tf, candle) {
    const arr = get(symbol, tf);
    const n = arr.length;
    if (n && arr[n - 1].openTime === candle.openTime) {
      arr[n - 1] = candle;
    } else {
      arr.push(candle);
    }
    set(symbol, tf, arr);
  }

  function trim(symbol, tf, max = 1200) {
    const arr = get(symbol, tf);
    if (arr.length > max) {
      set(symbol, tf, arr.slice(arr.length - max));
    }
  }

  function onClose(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function emitClose(payload) {
    for (const fn of listeners) {
      try { fn(payload); } catch {}
    }
  }

  function wsKlineToCandle(msg) {
    // Binance combined stream: msg.data.k
    const k = msg?.data?.k;
    if (!k) return null;
    return {
      symbol: String(k.s),
      tf: String(k.i),
      isClosed: !!k.x,
      candle: {
        openTime: Number(k.t),
        open: Number(k.o),
        high: Number(k.h),
        low: Number(k.l),
        close: Number(k.c),
        volume: Number(k.v),
        closeTime: Number(k.T),
      },
    };
  }

  function expectedCandleMs(tf) {
    return TF_TO_MINUTES[tf] * 60_000;
  }

  return {
    get,
    set,
    appendOrUpdate,
    trim,
    onClose,
    emitClose,
    wsKlineToCandle,
    expectedCandleMs,
    klineToCandle,
  };
}
