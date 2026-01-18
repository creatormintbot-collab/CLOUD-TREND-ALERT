// src/config/env.js
// MINIMAL PATCH: load .env for node + pm2 (tanpa refactor logic lain)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

/**
 * Load .env sekali di awal.
 * - Works for: `node src/index.js`, `node index.js`, PM2 start/restart
 * - Mencoba beberapa lokasi umum agar robust di VPS/PM2 (cwd kadang beda).
 */
function loadDotEnvOnce() {
  if (process.env.__DOTENV_LOADED__ === "1") return;

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const candidates = [
    process.env.DOTENV_CONFIG_PATH, // kalau user set manual
    path.resolve(process.cwd(), ".env"), // jika pm2 dijalankan dari root repo
    path.resolve(__dirname, "../../.env"), // src/config/env.js -> root repo
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        dotenv.config({ path: p });
        process.env.__DOTENV_LOADED__ = "1";
        process.env.__DOTENV_PATH__ = p;
        break;
      }
    } catch {
      // no-op (jangan ganggu boot)
    }
  }

  // Jika tidak ketemu, tetap set flag supaya tidak berulang-ulang load attempt.
  if (process.env.__DOTENV_LOADED__ !== "1") {
    process.env.__DOTENV_LOADED__ = "1";
    process.env.__DOTENV_PATH__ = "(not-found)";
  }
}

loadDotEnvOnce();

/* =========================
 * EXISTING ENV LOGIC (keep)
 * ========================= */

function toBool(v, fallback = false) {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function toInt(v, fallback) {
  if (v === undefined || v === null || v === "") return fallback;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toFloat(v, fallback) {
  if (v === undefined || v === null || v === "") return fallback;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function toCsvList(v, fallback = []) {
  if (v === undefined || v === null || v === "") return fallback;
  return String(v)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function required(name) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === "") {
    throw new Error(`Missing ${name}`);
  }
  return String(v).trim();
}

function optional(name, fallback = "") {
  const v = process.env[name];
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim();
  return s === "" ? fallback : s;
}

/**
 * Jangan ubah semantics:
 * - TELEGRAM_BOT_TOKEN wajib (kalau bot telegram diaktifkan)
 * - Trading/scan already final (kita cuma pastikan env kebaca)
 */
export function loadEnv() {
  // =========================
  // TELEGRAM
  // =========================
  const TELEGRAM_BOT_TOKEN = required("TELEGRAM_BOT_TOKEN");
  const TELEGRAM_CHAT_ID = optional("TELEGRAM_CHAT_ID", "");
  const ALLOWED_GROUP_IDS = toCsvList(optional("ALLOWED_GROUP_IDS", ""), []);

  // =========================
  // SERVER (optional)
  // =========================
  const PORT = toInt(optional("PORT", ""), 3000);
  const WEBHOOK_SECRET = optional("WEBHOOK_SECRET", "");
  const DISABLE_WEBHOOKS = toBool(optional("DISABLE_WEBHOOKS", ""), false);

  // =========================
  // MARKET / SCAN (LOCKED)
  // =========================
  const VOLUME_MARKET = optional("VOLUME_MARKET", "futures"); // futures/spot (locked by your strategy)
  const USE_TOP_VOLUME = toBool(optional("USE_TOP_VOLUME", ""), true);
  const TOP_VOLUME_N = toInt(optional("TOP_VOLUME_N", ""), 30);

  // Timeframes scan (LOCKED default)
  const SCAN_TIMEFRAMES = toCsvList(optional("SCAN_TIMEFRAMES", ""), ["15m", "30m", "1h"]);

  // =========================
  // LIMIT / QUALITY (LOCKED)
  // =========================
  const MAX_SIGNALS_PER_DAY = toInt(optional("MAX_SIGNALS_PER_DAY", ""), 5);
  const COOLDOWN_MINUTES = toInt(optional("COOLDOWN_MINUTES", ""), 45);

  // =========================
  // RECAP (UTC)
  // =========================
  const DAILY_RECAP = toBool(optional("DAILY_RECAP", ""), true);
  const DAILY_RECAP_TIME_UTC = optional("DAILY_RECAP_TIME_UTC", "00:00"); // kalau existing kamu beda, tetap aman (optional)

  // =========================
  // BINANCE / EXCHANGE (optional – trading logic already running)
  // =========================
  const BINANCE_API_KEY = optional("BINANCE_API_KEY", "");
  const BINANCE_API_SECRET = optional("BINANCE_API_SECRET", "");
  const BINANCE_TESTNET = toBool(optional("BINANCE_TESTNET", ""), false);

  // =========================
  // BINANCE FUTURES ENDPOINTS (MINIMAL FIX)
  // =========================
  // Required by src/exchange/binanceFutures.js (REST baseURL) + WS groups
  const BINANCE_FUTURES_REST = optional(
    "BINANCE_FUTURES_REST",
    BINANCE_TESTNET ? "https://testnet.binancefuture.com" : "https://fapi.binance.com"
  );
  const BINANCE_FUTURES_WS = optional(
    "BINANCE_FUTURES_WS",
    BINANCE_TESTNET ? "wss://stream.binancefuture.com" : "wss://fstream.binance.com"
  );

  // =========================
  // REST HARDENING DEFAULTS (backward compatible)
  // =========================
  const REST_TIMEOUT_MS = toInt(optional("REST_TIMEOUT_MS", ""), 15000);
  const REST_RETRY_MAX = toInt(optional("REST_RETRY_MAX", ""), 2);
  const REST_RETRY_BASE_MS = toInt(optional("REST_RETRY_BASE_MS", ""), 250);
  const REST_MAX_CONCURRENT = toInt(optional("REST_MAX_CONCURRENT", ""), 8);
  const REST_MIN_INTERVAL_MS = toInt(optional("REST_MIN_INTERVAL_MS", ""), 0);

  // =========================
  // WS HARDENING DEFAULTS (backward compatible)
  // =========================
  const WS_MAX_STREAMS_PER_SOCKET = toInt(optional("WS_MAX_STREAMS_PER_SOCKET", ""), 180);
  const WS_BACKOFF_BASE_MS = toInt(optional("WS_BACKOFF_BASE_MS", ""), 500);
  const WS_BACKOFF_MAX_MS = toInt(optional("WS_BACKOFF_MAX_MS", ""), 15000);
  const WS_PING_INTERVAL_MS = toInt(optional("WS_PING_INTERVAL_MS", ""), 15000);
  const WS_PONG_TIMEOUT_MS = toInt(optional("WS_PONG_TIMEOUT_MS", ""), 30000);

  // =========================
  // LOGGING (MINIMAL FIX)
  // =========================
  // Pino butuh level yang valid. Jika env tidak ada, fallback ke "info".
  // Ini tidak mengubah strategy, hanya mencegah crash saat boot.
  const LOG_LEVEL = optional("LOG_LEVEL", optional("PINO_LEVEL", "info"));

  // =========================
  // MISC
  // =========================
  const NODE_ENV = optional("NODE_ENV", "production");

  return {
    // telegram
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    ALLOWED_GROUP_IDS,

    // server
    PORT,
    WEBHOOK_SECRET,
    DISABLE_WEBHOOKS,

    // scan
    VOLUME_MARKET,
    USE_TOP_VOLUME,
    TOP_VOLUME_N,
    SCAN_TIMEFRAMES,

    // limits
    MAX_SIGNALS_PER_DAY,
    COOLDOWN_MINUTES,

    // recap
    DAILY_RECAP,
    DAILY_RECAP_TIME_UTC,

    // exchange
    BINANCE_API_KEY,
    BINANCE_API_SECRET,
    BINANCE_TESTNET,
    BINANCE_FUTURES_REST,
    BINANCE_FUTURES_WS,

    REST_TIMEOUT_MS,
    REST_RETRY_MAX,
    REST_RETRY_BASE_MS,
    REST_MAX_CONCURRENT,
    REST_MIN_INTERVAL_MS,

    WS_MAX_STREAMS_PER_SOCKET,
    WS_BACKOFF_BASE_MS,
    WS_BACKOFF_MAX_MS,
    WS_PING_INTERVAL_MS,
    WS_PONG_TIMEOUT_MS,

    // logging
    LOG_LEVEL,

    // misc
    NODE_ENV,

    // debug info (tidak mengubah logic—cuma info)
    __DOTENV_PATH__: process.env.__DOTENV_PATH__ || "",
  };
}

export const ENV = loadEnv();
export default ENV;