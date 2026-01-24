import path from "node:path";
import fs from "node:fs";

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
export const HTF_HARD_GATE_ENABLED = true;
export const HTF_BLOCK_ON_RECLAIM_NOT_CONFIRMED = true;
export const HTF_MAX_EMA21_DIST_ATR = 0.75;

// === Chop / Range hard filter ===
// Prevent high scores from choppy/range regimes (especially on LTF).
export const CHOP_FILTER_ENABLED = true;
export const CHOP_MIN_ADX = 18;          // Wilder ADX(14)
export const CHOP_MIN_ATR_PCT = 0.0035;  // ATR14 / close (0.35%)
export const CHOP_MIN_EMA_SEP_ATR = 0.25; // |EMA21-EMA55| / ATR14

// === 2-step confirmation (setup -> trigger) ===
export const TRIGGER_CONFIRM_ENABLED = true;
export const TRIGGER_REQUIRE_CLOSE_RECLAIM_EMA21 = true;
export const TRIGGER_REQUIRE_RSI_TURN = true;
export const TRIGGER_REQUIRE_MACD_HIST_TURN = false;

// === Position entry confirmation (monitor-side) ===
// Prevent zone-touch from being treated as FILLED immediately.
export const ENTRY_CONFIRM_MODE = "MID_CROSS"; // MID_CROSS | NONE
export const ENTRY_CONFIRM_DWELL_MS = 20_000;  // require persistence inside zone before FILLED


export function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SIGNALS_DIR)) fs.mkdirSync(SIGNALS_DIR, { recursive: true });
  if (!fs.existsSync(KLINES_DIR)) fs.mkdirSync(KLINES_DIR, { recursive: true });
}
