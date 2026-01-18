import "dotenv/config";

export function loadEnv() {
  const get = (k, d = undefined) => (process.env[k] ?? d);

  const toInt = (v, d) => {
    const n = Number.parseInt(String(v ?? ""), 10);
    return Number.isFinite(n) ? n : d;
  };

  const toFloat = (v, d) => {
    const n = Number.parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? n : d;
  };

  const toBool = (v, d = false) => {
    if (v === undefined) return d;
    return ["1", "true", "yes", "y", "on"].includes(String(v).toLowerCase());
  };

  const csv = (v) =>
    String(v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const env = {
    NODE_ENV: get("NODE_ENV", "production"),

    TELEGRAM_BOT_TOKEN: get("TELEGRAM_BOT_TOKEN", ""),
    ALLOWED_GROUP_IDS: csv(get("ALLOWED_GROUP_IDS", ""))
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n)),
    TELEGRAM_CHAT_ID: get("TELEGRAM_CHAT_ID", ""),
    TEST_SIGNALS_CHAT_ID: get("TEST_SIGNALS_CHAT_ID", ""),

    BINANCE_FUTURES_REST: get("BINANCE_FUTURES_REST", "https://fapi.binance.com"),
    BINANCE_FUTURES_WS: get("BINANCE_FUTURES_WS", "wss://fstream.binance.com/stream"),

    REST_TIMEOUT_MS: toInt(get("REST_TIMEOUT_MS"), 8000),
    REST_RETRY_MAX: toInt(get("REST_RETRY_MAX"), 4),
    REST_RETRY_BASE_MS: toInt(get("REST_RETRY_BASE_MS"), 400),

    WS_MAX_STREAMS_PER_SOCKET: toInt(get("WS_MAX_STREAMS_PER_SOCKET"), 180),
    WS_BACKOFF_BASE_MS: toInt(get("WS_BACKOFF_BASE_MS"), 500),
    WS_BACKOFF_MAX_MS: toInt(get("WS_BACKOFF_MAX_MS"), 20000),

    USE_TOP_VOLUME: toBool(get("USE_TOP_VOLUME"), true),
    TOP_VOLUME_N: toInt(get("TOP_VOLUME_N"), 50),
    TOP10_PER_TF: toInt(get("TOP10_PER_TF"), 10),
    SEND_TOP_N: toInt(get("SEND_TOP_N"), 3),

    SCAN_TIMEFRAMES: csv(get("SCAN_TIMEFRAMES", "15m,30m,1h")),
    SECONDARY_TIMEFRAME: get("SECONDARY_TIMEFRAME", "4h"),
    SECONDARY_MIN_SCORE: toInt(get("SECONDARY_MIN_SCORE"), 80),

    MAX_SIGNALS_PER_DAY: toInt(get("MAX_SIGNALS_PER_DAY"), 5),
    COOLDOWN_MINUTES: toInt(get("COOLDOWN_MINUTES"), 45),

    ZONE_ATR_MULT: toFloat(get("ZONE_ATR_MULT"), 0.15),
    SL_ATR_MULT: toFloat(get("SL_ATR_MULT"), 1.6),
    ADX_MIN: toFloat(get("ADX_MIN"), 18),
    ATR_PCT_MIN: toFloat(get("ATR_PCT_MIN"), 0.2),
    RSI_BULL_MIN: toFloat(get("RSI_BULL_MIN"), 52),
    RSI_BEAR_MAX: toFloat(get("RSI_BEAR_MAX"), 48),

    UNIVERSE_REFRESH_HOURS: toInt(get("UNIVERSE_REFRESH_HOURS"), 6),
    PRICE_MONITOR_INTERVAL_SEC: toInt(get("PRICE_MONITOR_INTERVAL_SEC"), 15),

    DAILY_RECAP_UTC: get("DAILY_RECAP_UTC", "00:05"),

    PORT: toInt(get("PORT"), 3000),
    DISABLE_WEBHOOKS: toBool(get("DISABLE_WEBHOOKS"), true),

    LOG_LEVEL: get("LOG_LEVEL", "info")
  };

  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN");
  }
  if (!env.ALLOWED_GROUP_IDS.length && !env.TELEGRAM_CHAT_ID) {
    // allowed, but user should set one
  }

  return env;
}
