export const TF_TO_MINUTES = {
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
};

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function roundToTick(n, tick = 0.0001) {
  if (!Number.isFinite(n)) return n;
  const inv = 1 / tick;
  return Math.round(n * inv) / inv;
}

export function nowMs() {
  return Date.now();
}

export function utcDateKey(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function tvSymbolPerp(symbol) {
  // TradingView perp convention: BINANCE:BTCUSDT.P
  return `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol}.P`;
}
