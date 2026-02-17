import path from "node:path";
import { DATA_DIR } from "../config/constants.js";
import { readJson, writeJsonAtomic } from "./jsonStore.js";

const FILE = path.join(DATA_DIR, "dm-subscribers.json");

function normalizeId(value) {
  const id = String(value ?? "").trim();
  return id || "";
}

function normalizeUtcDateKey(value) {
  const key = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "";
}

function normalizeEntry(raw) {
  if (typeof raw === "string" || typeof raw === "number") {
    const userId = normalizeId(raw);
    if (!userId) return null;
    return { userId, lastCheckedUtcDate: "", eligible: false };
  }

  if (!raw || typeof raw !== "object") return null;

  const userId = normalizeId(raw.userId ?? raw.chatId ?? raw.id);
  if (!userId) return null;

  const lastCheckedUtcDate = normalizeUtcDateKey(raw.lastCheckedUtcDate);
  const eligible = raw.eligible === true || raw.eligible === false ? raw.eligible : false;
  return { userId, lastCheckedUtcDate, eligible };
}

export class DmSubscribersRepo {
  constructor() {
    this.file = FILE;
    this._map = new Map();
    this._loaded = false;
    this._queue = Promise.resolve();
  }

  _snapshot() {
    return Array.from(this._map.values()).map((row) => ({
      userId: String(row.userId),
      lastCheckedUtcDate: normalizeUtcDateKey(row.lastCheckedUtcDate),
      eligible: !!row.eligible
    }));
  }

  _enqueuePersist() {
    this._queue = this._queue
      .then(() => writeJsonAtomic(this.file, this._snapshot()))
      .catch(() => {});
    return this._queue;
  }

  async load() {
    try {
      const data = await readJson(this.file, []);
      const list = Array.isArray(data)
        ? data
        : (Array.isArray(data?.subscribers) ? data.subscribers : []);

      for (const raw of list) {
        const row = normalizeEntry(raw);
        if (row) this._map.set(row.userId, row);
      }
    } catch {}
    this._loaded = true;
    return this.list();
  }

  list() {
    return Array.from(this._map.keys());
  }

  add(chatId) {
    const id = normalizeId(chatId);
    if (!id) return false;
    if (this._map.has(id)) return false;

    this._map.set(id, {
      userId: id,
      lastCheckedUtcDate: "",
      eligible: false
    });
    this._enqueuePersist();
    return true;
  }

  getEligibilityForUtcDay(userId, utcDayKey) {
    const id = normalizeId(userId);
    const day = normalizeUtcDateKey(utcDayKey);
    if (!id || !day) return { known: false, eligible: false };

    const row = this._map.get(id);
    if (!row) return { known: false, eligible: false };

    const known = normalizeUtcDateKey(row.lastCheckedUtcDate) === day;
    return { known, eligible: known ? !!row.eligible : false };
  }

  setEligibilityForUtcDay(userId, utcDayKey, eligible) {
    const id = normalizeId(userId);
    const day = normalizeUtcDateKey(utcDayKey);
    if (!id || !day) return false;

    const nextEligible = !!eligible;
    const prev = this._map.get(id) || { userId: id, lastCheckedUtcDate: "", eligible: false };

    if (prev.lastCheckedUtcDate === day && prev.eligible === nextEligible) return true;

    this._map.set(id, {
      userId: id,
      lastCheckedUtcDate: day,
      eligible: nextEligible
    });

    this._enqueuePersist();
    return true;
  }
}
