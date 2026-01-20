import path from "node:path";
import { KLINES_DIR } from "../config/constants.js";
import { readJson, writeJsonAtomic } from "./jsonStore.js";

function safeTf(tf) {
  return String(tf).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fileOf(symbol, tf) {
  const s = String(symbol).toUpperCase();
  const t = safeTf(tf);
  return path.join(KLINES_DIR, `${s}-${t}.json`);
}

export class KlinesRepo {
  constructor() {
    this._dirty = new Set(); // key: SYMBOL|tf
    this._provider = null;   // (symbol, tf) => candles[]
    this._queue = Promise.resolve();
  }

  setProvider(fn) {
    this._provider = typeof fn === "function" ? fn : null;
  }

  markDirty(symbol, tf) {
    const k = `${String(symbol).toUpperCase()}|${String(tf).toLowerCase()}`;
    this._dirty.add(k);
  }

  async load(symbol, tf) {
    const file = fileOf(symbol, tf);
    const fallback = { symbol: String(symbol).toUpperCase(), tf: String(tf).toLowerCase(), candles: [] };
    const data = await readJson(file, fallback);
    const candles = Array.isArray(data?.candles) ? data.candles : [];
    return candles;
  }

  async flushDirty({ maxKeys = 50 } = {}) {
    if (!this._provider) return;
    const keys = Array.from(this._dirty);
    if (!keys.length) return;

    const slice = keys.slice(0, Math.max(1, Number(maxKeys)));
    for (const k of slice) this._dirty.delete(k);

    this._queue = this._queue.then(async () => {
      for (const k of slice) {
        const [symbol, tf] = k.split("|");
        const candles = this._provider(symbol, tf) || [];
        const file = fileOf(symbol, tf);
        const payload = {
          symbol,
          tf,
          updatedAt: Date.now(),
          candles
        };
        await writeJsonAtomic(file, payload);
      }
    });

    return this._queue;
  }

  async flushAll() {
    while (this._dirty.size) {
      await this.flushDirty({ maxKeys: 100 });
    }
    await this._queue;
  }
}
