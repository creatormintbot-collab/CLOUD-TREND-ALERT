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

export function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SIGNALS_DIR)) fs.mkdirSync(SIGNALS_DIR, { recursive: true });
  if (!fs.existsSync(KLINES_DIR)) fs.mkdirSync(KLINES_DIR, { recursive: true });
}