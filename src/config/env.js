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

function listNum(v) {
  return list(v).map((x) => Number(x)).filter((n) => Number.isFinite(n));
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

  // Universe (liquidity floor + optional AUTO volume gate)
  LIQUIDITY_MIN_QUOTE_VOL_USDT: num(process.env.LIQUIDITY_MIN_QUOTE_VOL_USDT, 0),
  AUTO_VOLUME_TOP_N: num(process.env.AUTO_VOLUME_TOP_N, 0),
  AUTO_MIN_QUOTE_VOL_USDT: num(process.env.AUTO_MIN_QUOTE_VOL_USDT, 0),

  TOP10_PER_TF: num(process.env.TOP10_PER_TF, 10),
  SEND_TOP_N: num(process.env.SEND_TOP_N, 3),

  SCAN_TIMEFRAMES: list(process.env.SCAN_TIMEFRAMES || "15m,30m,1h").map((x) => x.toLowerCase()),
  SECONDARY_TIMEFRAME: (process.env.SECONDARY_TIMEFRAME || "4h").toLowerCase(),
  SECONDARY_MIN_SCORE: num(process.env.SECONDARY_MIN_SCORE, 80),

  // Strategy switch (optional). Empty = legacy scoring-only mode.
  STRATEGY: (process.env.STRATEGY || "").trim(),

  // Optional: override trend timeframe used by CTA gate (e.g. "1h" or "4h").
  // If empty, CTA will auto-map based on entry TF (15m->1h, 30m/1h/4h->4h).
  TREND_TF: (process.env.TREND_TF || "").toLowerCase(),

  // Optional: auto-scan timeframes override (empty = use existing behaviour)
  AUTO_TIMEFRAMES: list(process.env.AUTO_TIMEFRAMES || "").map((x) => x.toLowerCase()),

  // CTA PRO TREND tuning (optional)
  RECLAIM_M: num(process.env.RECLAIM_M, 3),
  RECLAIM_K_AUTO: num(process.env.RECLAIM_K_AUTO, 2),
  RECLAIM_K_SCAN: num(process.env.RECLAIM_K_SCAN, 1),
  NO_TRADE_EMA200_ATR_K: num(process.env.NO_TRADE_EMA200_ATR_K, 0.3),
  EXTEND_ATR_K: num(process.env.EXTEND_ATR_K, 1.5),

  // CTA soft gate thresholds (recommended)
  CTA_SOFT_MIN_SCORE_AUTO: num(process.env.CTA_SOFT_MIN_SCORE_AUTO, 0),
  CTA_SOFT_MIN_SCORE_SCAN: num(process.env.CTA_SOFT_MIN_SCORE_SCAN, 0),

  // Pullback relax (recommended)
  PULLBACK_MAX_ATR_AUTO: num(process.env.PULLBACK_MAX_ATR_AUTO, 0),
  PULLBACK_MAX_ATR_SCAN: num(process.env.PULLBACK_MAX_ATR_SCAN, 0),


  MAX_SIGNALS_PER_DAY: num(process.env.MAX_SIGNALS_PER_DAY, 5),
  COOLDOWN_MINUTES: num(process.env.COOLDOWN_MINUTES, 120),


  // AUTO rolling cooldowns (optional; default keeps existing behavior)
  AUTO_COOLDOWN_MINUTES: num(process.env.AUTO_COOLDOWN_MINUTES, 720),
  AUTO_PAIR_TF_COOLDOWN_MINUTES: num(process.env.AUTO_PAIR_TF_COOLDOWN_MINUTES, 720),

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

  CHART_RENDERER_DEBUG: bool(process.env.CHART_RENDERER_DEBUG, false),

  // Ichimoku HTF Compass (LOCKED)
  ICHIMOKU_ENABLED: bool(process.env.ICHIMOKU_ENABLED, false),
  ICHIMOKU_TF: (process.env.ICHIMOKU_TF || "4h").toLowerCase(),
  ICHIMOKU_SETTINGS: listNum(process.env.ICHIMOKU_SETTINGS || "9,26,52,26"),



  AUTO_MIN_SCORE: num(process.env.AUTO_MIN_SCORE, 85),

  // HTF permission hard gate (optional)
  HTF_HARD_GATE_ENABLED: bool(process.env.HTF_HARD_GATE_ENABLED, true),
  HTF_RECLAIM_MUST_CONFIRM: bool(process.env.HTF_RECLAIM_MUST_CONFIRM, true),
  HTF_MAX_EMA21_DIST_ATR: num(process.env.HTF_MAX_EMA21_DIST_ATR, 0.75),

  // Chop / range hard gate (optional)
  CHOP_FILTER_ENABLED: bool(process.env.CHOP_FILTER_ENABLED, true),
  CHOP_MIN_ADX: num(process.env.CHOP_MIN_ADX, 20),
  CHOP_MIN_ATR_PCT: num(process.env.CHOP_MIN_ATR_PCT, 0.0025),
  CHOP_MIN_EMA_SEP_ATR: num(process.env.CHOP_MIN_EMA_SEP_ATR, 0.2),

  // Setup -> Trigger confirmation (optional)
  TRIGGER_ENABLED: bool(process.env.TRIGGER_ENABLED, true),
  TRIGGER_MODE: (process.env.TRIGGER_MODE || "EMA21_RSI_TURN").trim(),

  // Monitor entry confirmation (optional)
  ENTRY_CONFIRM_MODE: (process.env.ENTRY_CONFIRM_MODE || "MID_CROSS").trim(),
  ENTRY_CONFIRM_DWELL_MS: num(process.env.ENTRY_CONFIRM_DWELL_MS, 15000),
  ENTRY_CONFIRM_MAX_WAIT_MS: num(process.env.ENTRY_CONFIRM_MAX_WAIT_MS, 0)
};