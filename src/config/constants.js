import path from "node:path";
import fs from "node:fs";
import { env } from "./env.js";

export const ROOT_DIR = process.cwd();
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const SIGNALS_DIR = path.join(DATA_DIR, "signals");
export const KLINES_DIR = path.join(DATA_DIR, "klines");

export const STATUS = {
  // Lifecycle
  PENDING_ENTRY: "PENDING_ENTRY",
  ENTRY: "ENTRY",
  RUNNING: "RUNNING",
  CLOSED: "CLOSED",
  EXPIRED: "EXPIRED"
};

// === Hard gates (LTF permission layer) ===
// Locked intent: LTF signals must respect HTF (4H) permission.
export const HTF_HARD_GATE_ENABLED = Boolean(env.HTF_HARD_GATE_ENABLED);
export const HTF_RECLAIM_MUST_CONFIRM = Boolean(env.HTF_RECLAIM_MUST_CONFIRM);
export const HTF_BLOCK_ON_RECLAIM_NOT_CONFIRMED = HTF_RECLAIM_MUST_CONFIRM;
export const HTF_MAX_EMA21_DIST_ATR = Number(env.HTF_MAX_EMA21_DIST_ATR);

// === Chop / Range hard filter ===
// Prevent high scores from choppy/range regimes (especially on LTF).
export const CHOP_FILTER_ENABLED = Boolean(env.CHOP_FILTER_ENABLED);
export const CHOP_MIN_ADX = Number(env.CHOP_MIN_ADX);          // Wilder ADX(14)
export const CHOP_MIN_ATR_PCT = Number(env.CHOP_MIN_ATR_PCT);  // ATR14 / close (ratio)
export const CHOP_MIN_EMA_SEP_ATR = Number(env.CHOP_MIN_EMA_SEP_ATR); // |EMA21-EMA55| / ATR14

// === 2-step confirmation (setup -> trigger) ===
const _TRIGGER_MODE = String(env.TRIGGER_MODE || "").trim().toUpperCase();
export const TRIGGER_CONFIRM_ENABLED = Boolean(env.TRIGGER_ENABLED);
export const TRIGGER_REQUIRE_CLOSE_RECLAIM_EMA21 = TRIGGER_CONFIRM_ENABLED && (
  _TRIGGER_MODE === "EMA21_RSI_TURN" || _TRIGGER_MODE === "EMA21_CLOSE"
);
export const TRIGGER_REQUIRE_RSI_TURN = TRIGGER_CONFIRM_ENABLED && (
  _TRIGGER_MODE === "EMA21_RSI_TURN" || _TRIGGER_MODE === "RSI_TURN"
);
export const TRIGGER_REQUIRE_MACD_HIST_TURN = TRIGGER_CONFIRM_ENABLED && (
  _TRIGGER_MODE === "MACD_HIST_TURN"
);

// === Position entry confirmation (monitor-side) ===
// Prevent zone-touch from being treated as FILLED immediately.
export const ENTRY_CONFIRM_MODE = String(env.ENTRY_CONFIRM_MODE || "MID_CROSS").trim(); // MID_CROSS | IMMEDIATE
export const ENTRY_CONFIRM_DWELL_MS = Number(env.ENTRY_CONFIRM_DWELL_MS);  // require persistence inside zone before FILLED
export const ENTRY_CONFIRM_MAX_WAIT_MS = Number(env.ENTRY_CONFIRM_MAX_WAIT_MS); // 0 = no max wait

// === Intraday Trade Plan defaults ===
const _INTRADAY_TFS = Array.isArray(env?.INTRADAY_TIMEFRAMES) && env.INTRADAY_TIMEFRAMES.length
  ? env.INTRADAY_TIMEFRAMES
  : ["15m", "30m", "1h"];
export const INTRADAY_TIMEFRAMES = _INTRADAY_TFS.map((tf) => String(tf || "").toLowerCase()).filter(Boolean);
export const INTRADAY_RR_CAP = 2.0;
export const INTRADAY_SR_PIVOT_L = 3;
export const INTRADAY_SR_PIVOT_R = 3;
export const INTRADAY_SR_ATR_MULT = 0.25;
export const INTRADAY_SR_PCT_TOL = 0.002; // 0.20%
export const INTRADAY_SL_ATR_BUFFER = 0.25;
export const INTRADAY_SL_ATR_FALLBACK = 1.2;
export const INTRADAY_SL_ATR_MULT = 0.6;
export const INTRADAY_SL_FALLBACK_ATR_MULT = 1.5;
export const INTRADAY_MIN_RISK_PCT = 1.0;
export const INTRADAY_TP1_MIN_RR = 1.0;
export const INTRADAY_MIN_GAP_ATR_MULT = 0.25;
export const INTRADAY_MIN_GAP_PCT = 0.10; // percent
export const INTRADAY_MACRO_ADJ = 10;
export const INTRADAY_REGIME_ATR_PCT_MIN = 0.0025;
export const INTRADAY_REGIME_SLOPE_LOOKBACK = 5;
export const INTRADAY_MIN_CANDLES = 220;
export const INTRADAY_SCAN_TOP_N = 3;
export const INTRADAY_SR_LEVELS_MAX = 8;
export const INTRADAY_COOLDOWN_MINUTES = 60;
export const SWING_SCAN_TOP_N = 1;


export function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SIGNALS_DIR)) fs.mkdirSync(SIGNALS_DIR, { recursive: true });
  if (!fs.existsSync(KLINES_DIR)) fs.mkdirSync(KLINES_DIR, { recursive: true });
}
