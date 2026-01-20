function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function bool(v, d) {
  if (v === undefined || v === null || v === "") return d;
  return String(v).toLowerCase() === "true" || String(v) === "1";
}
function list(v) {
  if (!v) return [];
  return String(v).split(",").map((x) => x.trim()).filter(Boolean);
}

export const env = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  ALLOWED_GROUP_IDS: list(process.env.ALLOWED_GROUP_IDS).map(String),
  TEST_SIGNALS_CHAT_ID: process.env.TEST_SIGNALS_CHAT_ID ? String(process.env.TEST_SIGNALS_CHAT_ID) : "",
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID ? String(process.env.TELEGRAM_CHAT_ID) : "",

  BINANCE_FUTURES_REST: process.env.BINANCE_FUTURES_REST || "https://fapi.binance.com",
  BINANCE_FUTURES_WS: process.env.BINANCE_FUTURES_WS || "wss://fstream.binance.com/stream",

  REST_TIMEOUT_MS: num(process.env.REST_TIMEOUT_MS, 8000),
  REST_RETRY_MAX: num(process.env.REST_RETRY_MAX, 2),
  REST_RETRY_BASE_MS: num(process.env.REST_RETRY_BASE_MS, 250),

  WS_MAX_STREAMS_PER_SOCKET: num(process.env.WS_MAX_STREAMS_PER_SOCKET, 180),
  WS_BACKOFF_BASE_MS: num(process.env.WS_BACKOFF_BASE_MS, 500),
  WS_BACKOFF_MAX_MS: num(process.env.WS_BACKOFF_MAX_MS, 30000),

  VOLUME_MARKET: process.env.VOLUME_MARKET || "USDT",
  USE_TOP_VOLUME: bool(process.env.USE_TOP_VOLUME, true),
  TOP_VOLUME_N: num(process.env.TOP_VOLUME_N, 50),
  TOP10_PER_TF: num(process.env.TOP10_PER_TF, 10),
  SEND_TOP_N: num(process.env.SEND_TOP_N, 3),

  SCAN_TIMEFRAMES: list(process.env.SCAN_TIMEFRAMES || "15m,30m,1h"),
  SECONDARY_TIMEFRAME: (process.env.SECONDARY_TIMEFRAME || "4h").toLowerCase(),
  SECONDARY_MIN_SCORE: num(process.env.SECONDARY_MIN_SCORE, 80),

  MAX_SIGNALS_PER_DAY: num(process.env.MAX_SIGNALS_PER_DAY, 5),
  COOLDOWN_MINUTES: num(process.env.COOLDOWN_MINUTES, 120),

  ZONE_ATR_MULT: num(process.env.ZONE_ATR_MULT, 0.15),
  SL_ATR_MULT: num(process.env.SL_ATR_MULT, 1.6), // LOCKED validate
  ADX_MIN: num(process.env.ADX_MIN, 18),
  ATR_PCT_MIN: num(process.env.ATR_PCT_MIN, 0.002),
  RSI_BULL_MIN: num(process.env.RSI_BULL_MIN, 52),
  RSI_BEAR_MAX: num(process.env.RSI_BEAR_MAX, 48),

  UNIVERSE_REFRESH_HOURS: num(process.env.UNIVERSE_REFRESH_HOURS, 6),
  PRICE_MONITOR_INTERVAL_SEC: num(process.env.PRICE_MONITOR_INTERVAL_SEC, 10),
  DAILY_RECAP: bool(process.env.DAILY_RECAP, true),
  DAILY_RECAP_UTC: process.env.DAILY_RECAP_UTC || "00:05",

  PORT: num(process.env.PORT, 3000),
  DISABLE_WEBHOOKS: bool(process.env.DISABLE_WEBHOOKS, true),
  LOG_LEVEL: process.env.LOG_LEVEL || "info",

  AUTO_MIN_SCORE: num(process.env.AUTO_MIN_SCORE, 85)
};
