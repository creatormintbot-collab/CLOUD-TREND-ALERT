import path from "node:path";
import { DATA_DIR } from "../config/constants.js";
import { readJson, writeJsonAtomic } from "./jsonStore.js";

const FILE = path.join(DATA_DIR, "dm-subscribers.json");

function normalizeId(value) {
  const id = String(value ?? "").trim();
  return id || "";
}

export class DmSubscribersRepo {
  constructor() {
    this.file = FILE;
    this._set = new Set();
    this._loaded = false;
    this._queue = Promise.resolve();
  }

  async load() {
    try {
      const data = await readJson(this.file, []);
      const list = Array.isArray(data) ? data : [];
      for (const raw of list) {
        const id = normalizeId(raw);
        if (id) this._set.add(id);
      }
    } catch {}
    this._loaded = true;
    return this.list();
  }

  list() {
    return Array.from(this._set.values());
  }

  add(chatId) {
    const id = normalizeId(chatId);
    if (!id) return false;
    if (this._set.has(id)) return false;

    this._set.add(id);
    this._queue = this._queue
      .then(() => writeJsonAtomic(this.file, this.list()))
      .catch(() => {});

    return true;
  }
}
