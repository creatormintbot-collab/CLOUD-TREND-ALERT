import { env } from "./env.js";

export function validateEnvOrThrow() {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  if (!env.BINANCE_FUTURES_REST) throw new Error("Missing BINANCE_FUTURES_REST");
  if (!env.BINANCE_FUTURES_WS) throw new Error("Missing BINANCE_FUTURES_WS");
  if (Number(env.SL_ATR_MULT) !== 1.6) throw new Error("SL_ATR_MULT is LOCKED to 1.6");
  if (env.DAILY_RECAP === true) {
    if (!env.DAILY_RECAP_UTC || env.DAILY_RECAP_UTC.split(":").length !== 2) {
      throw new Error("DAILY_RECAP_UTC must be HH:MM");
    }
  }
  if (!Array.isArray(env.SCAN_TIMEFRAMES) || env.SCAN_TIMEFRAMES.length === 0) {
    throw new Error("SCAN_TIMEFRAMES invalid");
  }

  // Timeframe validation (prevents silent mismatches like "15M" or "1H")
  const allowedTfs = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w"]);
  const badScan = (env.SCAN_TIMEFRAMES || []).filter((tf) => !allowedTfs.has(String(tf).toLowerCase()));
  if (badScan.length) throw new Error(`SCAN_TIMEFRAMES contains invalid timeframe(s): ${badScan.join(", ")}`);

  if (env.SECONDARY_TIMEFRAME && !allowedTfs.has(String(env.SECONDARY_TIMEFRAME).toLowerCase())) {
    throw new Error(`SECONDARY_TIMEFRAME invalid: ${env.SECONDARY_TIMEFRAME}`);
  }

  if (Array.isArray(env.AUTO_TIMEFRAMES) && env.AUTO_TIMEFRAMES.length) {
    const badAuto = env.AUTO_TIMEFRAMES.filter((tf) => !allowedTfs.has(String(tf).toLowerCase()));
    if (badAuto.length) throw new Error(`AUTO_TIMEFRAMES contains invalid timeframe(s): ${badAuto.join(", ")}`);
  }
  if (Array.isArray(env.INTRADAY_TIMEFRAMES) && env.INTRADAY_TIMEFRAMES.length) {
    const badIntraday = env.INTRADAY_TIMEFRAMES.filter((tf) => !allowedTfs.has(String(tf).toLowerCase()));
    if (badIntraday.length) throw new Error(`INTRADAY_TIMEFRAMES contains invalid timeframe(s): ${badIntraday.join(", ")}`);
  }

  // Strategy validation (optional)
  const strategy = String(env.STRATEGY || "").trim();
  const allowedStrategies = new Set(["", "LEGACY", "CTA_PRO_TREND", "CTA", "PRO_TREND"]);
  if (!allowedStrategies.has(strategy)) {
    throw new Error(`STRATEGY invalid: ${strategy}`);
  }

  if (env.TREND_TF && !allowedTfs.has(String(env.TREND_TF).toLowerCase())) {
    throw new Error(`TREND_TF invalid: ${env.TREND_TF}`);
  }

  // Universe validation (liquidity floor + AUTO volume gate)
  if (env.USE_TOP_VOLUME && (!Number.isFinite(env.TOP_VOLUME_N) || Number(env.TOP_VOLUME_N) <= 0)) {
    throw new Error("TOP_VOLUME_N must be > 0 when USE_TOP_VOLUME=true");
  }

  // /top command requires at least 10 symbols available in universe cache
  if (!Number.isFinite(env.TOP_VOLUME_N) || Number(env.TOP_VOLUME_N) < 10) {
    throw new Error("TOP_VOLUME_N must be >= 10");
  }
  if (!Number.isFinite(env.UNIVERSE_REFRESH_HOURS) || Number(env.UNIVERSE_REFRESH_HOURS) <= 0) {
    throw new Error("UNIVERSE_REFRESH_HOURS must be > 0");
  }

  if (!Number.isFinite(env.LIQUIDITY_MIN_QUOTE_VOL_USDT) || Number(env.LIQUIDITY_MIN_QUOTE_VOL_USDT) < 0) {
    throw new Error("LIQUIDITY_MIN_QUOTE_VOL_USDT must be >= 0");
  }
  if (!Number.isFinite(env.AUTO_MIN_QUOTE_VOL_USDT) || Number(env.AUTO_MIN_QUOTE_VOL_USDT) < 0) {
    throw new Error("AUTO_MIN_QUOTE_VOL_USDT must be >= 0");
  }
  if (!Number.isFinite(env.AUTO_VOLUME_TOP_N) || Number(env.AUTO_VOLUME_TOP_N) < 0) {
    throw new Error("AUTO_VOLUME_TOP_N must be >= 0");
  }
  if (Number(env.AUTO_VOLUME_TOP_N) > 0 && !Number.isInteger(Number(env.AUTO_VOLUME_TOP_N))) {
    throw new Error("AUTO_VOLUME_TOP_N must be an integer");
  }

  // Hard gate / confirmation knobs (optional)
  if (!Number.isFinite(env.HTF_MAX_EMA21_DIST_ATR) || Number(env.HTF_MAX_EMA21_DIST_ATR) < 0) {
    throw new Error("HTF_MAX_EMA21_DIST_ATR must be a finite number >= 0");
  }

  if (!Number.isFinite(env.CHOP_MIN_ADX) || Number(env.CHOP_MIN_ADX) < 0) {
    throw new Error("CHOP_MIN_ADX must be a finite number >= 0");
  }
  if (!Number.isFinite(env.CHOP_MIN_ATR_PCT) || Number(env.CHOP_MIN_ATR_PCT) < 0 || Number(env.CHOP_MIN_ATR_PCT) > 1) {
    throw new Error("CHOP_MIN_ATR_PCT must be a finite number between 0 and 1");
  }
  if (!Number.isFinite(env.CHOP_MIN_EMA_SEP_ATR) || Number(env.CHOP_MIN_EMA_SEP_ATR) < 0) {
    throw new Error("CHOP_MIN_EMA_SEP_ATR must be a finite number >= 0");
  }

  if (env.TRIGGER_ENABLED) {
    const tm = String(env.TRIGGER_MODE || "").trim();
    const allowedTriggerModes = new Set(["EMA21_RSI_TURN", "EMA21_CLOSE", "RSI_TURN", "MACD_HIST_TURN"]);
    if (!allowedTriggerModes.has(tm)) {
      throw new Error(`TRIGGER_MODE invalid: ${tm}`);
    }
  }

  const ecm = String(env.ENTRY_CONFIRM_MODE || "").trim();
  const allowedEntryConfirmModes = new Set(["MID_CROSS", "IMMEDIATE"]);
  if (!allowedEntryConfirmModes.has(ecm)) {
    throw new Error(`ENTRY_CONFIRM_MODE invalid: ${ecm}`);
  }
  if (!Number.isFinite(env.ENTRY_CONFIRM_DWELL_MS) || Number(env.ENTRY_CONFIRM_DWELL_MS) < 0) {
    throw new Error("ENTRY_CONFIRM_DWELL_MS must be a finite number >= 0");
  }
  if (!Number.isFinite(env.ENTRY_CONFIRM_MAX_WAIT_MS) || Number(env.ENTRY_CONFIRM_MAX_WAIT_MS) < 0) {
    throw new Error("ENTRY_CONFIRM_MAX_WAIT_MS must be a finite number >= 0");
  }
}
