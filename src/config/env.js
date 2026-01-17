import { TF_TO_MINUTES } from "./constants.js";

function req(name, v) {
  if (!v) throw new Error(`Missing ENV: ${name}`);
  return v;
}

function num(name, v, def = null) {
  if (v == null || v === "") {
    if (def == null) throw new Error(`Missing ENV: ${name}`);
    return def;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number ENV: ${name}=${v}`);
  return n;
}

function list(name, v, def = "") {
  const s = (v ?? def).trim();
  if (!s) return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export const ENV = {
  BOT_NAME: process.env.BOT_NAME || "CLOUD TREND ALERT",

  TELEGRAM_BOT_TOKEN: req("TELEGRAM_BOT_TOKEN", process.env.TELEGRAM_BOT_TOKEN),
  ALLOWED_GROUP_IDS: list("ALLOWED_GROUP_IDS", process.env.ALLOWED_GROUP_IDS),

  BINANCE_FAPI: process.env.BINANCE_FAPI || "https://fapi.binance.com",
  BINANCE_WS: process.env.BINANCE_WS || "wss://fstream.binance.com/stream",

  USE_TOP_VOLUME: String(process.env.USE_TOP_VOLUME ?? "1") === "1",
  TOP_VOLUME_N: num("TOP_VOLUME_N", process.env.TOP_VOLUME_N, 50),
  UNIVERSE_REFRESH_HOURS: num("UNIVERSE_REFRESH_HOURS", process.env.UNIVERSE_REFRESH_HOURS, 6),

  SCAN_TIMEFRAMES: list("SCAN_TIMEFRAMES", process.env.SCAN_TIMEFRAMES, "15m,30m,1h"),
  SECONDARY_TIMEFRAME: process.env.SECONDARY_TIMEFRAME || "4h",
  SECONDARY_MIN_SCORE: num("SECONDARY_MIN_SCORE", process.env.SECONDARY_MIN_SCORE, 75),

  MAX_SIGNALS_PER_TF_PER_CANDLE: num("MAX_SIGNALS_PER_TF_PER_CANDLE", process.env.MAX_SIGNALS_PER_TF_PER_CANDLE, 3),
  COOLDOWN_CANDLES: num("COOLDOWN_CANDLES", process.env.COOLDOWN_CANDLES, 12),
  BACKFILL_CANDLES: num("BACKFILL_CANDLES", process.env.BACKFILL_CANDLES, 300),

  ZONE_ATR_MULT: num("ZONE_ATR_MULT", process.env.ZONE_ATR_MULT, 0.15),
  SL_ATR_MULT: num("SL_ATR_MULT", process.env.SL_ATR_MULT, 1.6),

  TP1_PARTIAL: num("TP1_PARTIAL", process.env.TP1_PARTIAL, 30),
  TP2_PARTIAL: num("TP2_PARTIAL", process.env.TP2_PARTIAL, 60),
  TP3_PARTIAL: num("TP3_PARTIAL", process.env.TP3_PARTIAL, 100),

  EMA_FAST: num("EMA_FAST", process.env.EMA_FAST, 21),
  EMA_MID: num("EMA_MID", process.env.EMA_MID, 55),
  EMA_SLOW: num("EMA_SLOW", process.env.EMA_SLOW, 200),
  RSI_LEN: num("RSI_LEN", process.env.RSI_LEN, 14),
  ATR_LEN: num("ATR_LEN", process.env.ATR_LEN, 14),
  ADX_LEN: num("ADX_LEN", process.env.ADX_LEN, 14),
  ADX_MIN: num("ADX_MIN", process.env.ADX_MIN, 18),
  ATR_PCT_MIN: num("ATR_PCT_MIN", process.env.ATR_PCT_MIN, 0.2),

  MACRO_TF: process.env.MACRO_TF || "4h",
  MACRO_BASKET_SIZE: num("MACRO_BASKET_SIZE", process.env.MACRO_BASKET_SIZE, 10),

  POSITION_POLL_MS: num("POSITION_POLL_MS", process.env.POSITION_POLL_MS, 8000),
  TF4H_POLL_MS: num("TF4H_POLL_MS", process.env.TF4H_POLL_MS, 60000),
  DAILY_RECAP_CHECK_MS: num("DAILY_RECAP_CHECK_MS", process.env.DAILY_RECAP_CHECK_MS, 30000),
};

for (const tf of ENV.SCAN_TIMEFRAMES.concat([ENV.SECONDARY_TIMEFRAME])) {
  if (!TF_TO_MINUTES[tf]) throw new Error(`Unsupported timeframe: ${tf}`);
}
