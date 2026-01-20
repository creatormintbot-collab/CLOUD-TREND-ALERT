import path from "node:path";
import { DATA_DIR } from "../config/constants.js";
import { readJson, writeJsonAtomic } from "./jsonStore.js";

const FILE = path.join(DATA_DIR, "positions.json");

export class PositionsRepo {
  constructor() {
    this.positions = {};
    this._queue = Promise.resolve();
  }

  async load() {
    this.positions = await readJson(FILE, {});
    if (!this.positions) this.positions = {};
  }

  listActive() {
    return Object.values(this.positions).filter((p) => p && p.status !== "CLOSED");
  }

  upsert(pos) {
    this.positions[pos.id] = pos;
  }

  async flush() {
    this._queue = this._queue.then(() => writeJsonAtomic(FILE, this.positions));
    return this._queue;
  }
}
