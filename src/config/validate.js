import { env } from "./env.js";

export function validateEnvOrThrow() {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  if (!env.BINANCE_FUTURES_REST) throw new Error("Missing BINANCE_FUTURES_REST");
  if (!env.BINANCE_FUTURES_WS) throw new Error("Missing BINANCE_FUTURES_WS");
  if (Number(env.SL_ATR_MULT) !== 1.6) throw new Error("SL_ATR_MULT is LOCKED to 1.6");
  if (!env.DAILY_RECAP_UTC || env.DAILY_RECAP_UTC.split(":").length !== 2) {
    throw new Error("DAILY_RECAP_UTC must be HH:MM");
  }
  if (!Array.isArray(env.SCAN_TIMEFRAMES) || env.SCAN_TIMEFRAMES.length === 0) {
    throw new Error("SCAN_TIMEFRAMES invalid");
  }
}
