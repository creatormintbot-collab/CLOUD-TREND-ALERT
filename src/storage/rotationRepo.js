import path from "node:path";
import { DATA_DIR } from "../config/constants.js";
import { readJson, writeJsonAtomic } from "./jsonStore.js";

const FILE = path.join(DATA_DIR, "scan-rotation.json");

export class RotationRepo {
  constructor({ cooldownMinutes = 120 } = {}) {
    this.cooldownMinutes = Number(cooldownMinutes);
    this.state = { lastSent: {}, cursor: 0 };
    this._queue = Promise.resolve();
  }

  async load() {
    this.state = await readJson(FILE, this.state);
    if (!this.state.lastSent) this.state.lastSent = {};
    if (!Number.isFinite(this.state.cursor)) this.state.cursor = 0;
  }

  mark(symbol) {
    this.state.lastSent[String(symbol).toUpperCase()] = Date.now();
  }

  allowed(symbol) {
    const s = String(symbol).toUpperCase();
    const t = Number(this.state.lastSent[s] || 0);
    if (!t) return true;
    return Date.now() - t >= this.cooldownMinutes * 60_000;
  }

  pickNext(symbols) {
    const list = (symbols || []).map((s) => String(s).toUpperCase());
    if (!list.length) return null;
    const n = list.length;
    let start = this.state.cursor % n;

    for (let i = 0; i < n; i++) {
      const idx = (start + i) % n;
      const sym = list[idx];
      if (this.allowed(sym)) {
        this.state.cursor = idx + 1;
        this.mark(sym);
        return sym;
      }
    }

    // if all blocked, allow round-robin anyway
    const sym = list[start];
    this.state.cursor = start + 1;
    this.mark(sym);
    return sym;
  }

  async flush() {
    this._queue = this._queue.then(() => writeJsonAtomic(FILE, this.state));
    return this._queue;
  }
}
