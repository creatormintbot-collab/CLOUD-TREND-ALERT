import path from "node:path";
import { DATA_DIR } from "../config/constants.js";
import { utcDateKeyNow } from "../utils/time.js";
import { readJson, writeJsonAtomic } from "./jsonStore.js";

const FILE = path.join(DATA_DIR, "dm-dedup.json");

function initData() {
  return { dayKeyUTC: utcDateKeyNow(), keys: {} };
}

export class DedupRepo {
  constructor() {
    this.data = initData();
  }

  async load() {
    const loaded = await readJson(FILE, initData());
    this.data = (loaded && typeof loaded === "object") ? loaded : initData();
    if (!this.data.keys || typeof this.data.keys !== "object") this.data.keys = {};
    if (!this.data.dayKeyUTC) this.data.dayKeyUTC = utcDateKeyNow();
    await writeJsonAtomic(FILE, this.data);
    return this.data;
  }

  ensureDay() {
    const today = utcDateKeyNow();
    if (this.data.dayKeyUTC !== today) {
      this.data = initData();
    }
  }

  has(key) {
    this.ensureDay();
    const k = String(key || "");
    if (!k) return false;
    return !!this.data.keys[k];
  }

  add(key) {
    this.ensureDay();
    const k = String(key || "");
    if (!k) return false;
    this.data.keys[k] = true;
    return true;
  }

  async flush() {
    await writeJsonAtomic(FILE, this.data);
  }
}
