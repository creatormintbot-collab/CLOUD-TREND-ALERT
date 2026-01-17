import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const POS_PATH = path.join(DATA_DIR, "positions.json");

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadPositions() {
  ensureDir();
  if (!fs.existsSync(POS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(POS_PATH, "utf8"));
  } catch {
    return [];
  }
}

export function savePositions(positions) {
  ensureDir();
  fs.writeFileSync(POS_PATH, JSON.stringify(positions, null, 2));
}

export function upsertPosition(positions, pos) {
  const idx = positions.findIndex(
    (p) => p.symbol === pos.symbol && p.timeframe === pos.timeframe && p.openedAt === pos.openedAt
  );
  if (idx >= 0) positions[idx] = pos;
  else positions.push(pos);
  return positions;
}

export function findRunningPosition(positions, symbol, timeframe) {
  return positions.find((p) => p.symbol === symbol && p.timeframe === timeframe && p.status === "RUNNING") || null;
}
