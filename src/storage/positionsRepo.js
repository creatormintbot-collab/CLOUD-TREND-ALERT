import path from "node:path";
import fs from "node:fs";
import { DATA_DIR } from "../config/constants.js";
import { readJson, writeJsonAtomic } from "./jsonStore.js";

// NOTE: repo path is aligned with current project structure:
// data/position.json (primary). We also support legacy data/positions.json.
const FILE_PRIMARY = path.join(DATA_DIR, "position.json");
const FILE_LEGACY = path.join(DATA_DIR, "positions.json");

export class PositionsRepo {
  constructor() {
    this.positions = {};
    this._queue = Promise.resolve();
  }

  async load() {
    // Prefer primary file name.
    let data = await readJson(FILE_PRIMARY, null);

    // If primary missing/empty, try legacy.
    if (!data || (typeof data === "object" && Object.keys(data).length === 0)) {
      if (fs.existsSync(FILE_LEGACY)) {
        const legacy = await readJson(FILE_LEGACY, null);
        if (legacy && typeof legacy === "object") data = legacy;
      }
    }

    this.positions = (data && typeof data === "object") ? data : {};
    return this.positions;
  }

  // New: list all positions (required for /status + /info + recap aggregation)
  listAll() {
    return Object.values(this.positions);
  }

  // Backward compatible aliases
  list() {
    return this.listAll();
  }

  getAll() {
    return this.listAll();
  }

  listActive() {
    // Active = anything not CLOSED and not EXPIRED
    return Object.values(this.positions).filter((p) => p && p.status !== "CLOSED" && p.status !== "EXPIRED");
  }

  findActiveBySymbolTf(symbol, tf) {
    const s = String(symbol || "").toUpperCase();
    const t = String(tf || "").toLowerCase();
    if (!s || !t) return null;

    for (const p of Object.values(this.positions)) {
      if (!p) continue;
      if (p.status === "CLOSED" || p.status === "EXPIRED") continue;
      if (String(p.symbol || "").toUpperCase() === s && String(p.tf || "").toLowerCase() === t) return p;
    }
    return null;
  }

  upsert(pos) {
    this.positions[pos.id] = pos;
  }

  async flush() {
    this._queue = this._queue.then(async () => {
      // Write primary (current). Also mirror to legacy file name to avoid data loss
      // if older scripts still read the legacy path.
      await writeJsonAtomic(FILE_PRIMARY, this.positions);
      try {
        await writeJsonAtomic(FILE_LEGACY, this.positions);
      } catch {}
    });
    return this._queue;
  }
}