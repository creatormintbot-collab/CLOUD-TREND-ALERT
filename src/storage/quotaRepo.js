import path from "node:path";
import { DATA_DIR } from "../config/constants.js";
import { env } from "../config/env.js";
import { utcDateKeyNow } from "../utils/time.js";
import { readJson, writeJsonAtomic } from "./jsonStore.js";

const FILE = path.join(DATA_DIR, "dm-quota.json");

function initData() {
  return { dayKeyUTC: utcDateKeyNow(), scanCountByUser: {}, autoCountByUser: {} };
}

export class QuotaRepo {
  constructor() {
    this.data = initData();
  }

  async load() {
    const loaded = await readJson(FILE, initData());
    this.data = (loaded && typeof loaded === "object") ? loaded : initData();
    if (!this.data.scanCountByUser || typeof this.data.scanCountByUser !== "object") this.data.scanCountByUser = {};
    if (!this.data.autoCountByUser || typeof this.data.autoCountByUser !== "object") this.data.autoCountByUser = {};
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

  getDayKey() {
    this.ensureDay();
    return this.data.dayKeyUTC;
  }

  canScan(userId, tier = "FREE") {
    this.ensureDay();
    const t = String(tier || "FREE").toUpperCase();
    if (t === "PREMIUM") return true;
    const uid = String(userId || "");
    const count = Number(this.data.scanCountByUser[uid] || 0);
    return count < Number(env.DM_FREE_SCAN_LIMIT || 10);
  }

  incScan(userId) {
    this.ensureDay();
    const uid = String(userId || "");
    if (!uid) return 0;
    const next = Number(this.data.scanCountByUser[uid] || 0) + 1;
    this.data.scanCountByUser[uid] = next;
    return next;
  }

  canAuto(userId, tier = "FREE") {
    this.ensureDay();
    const t = String(tier || "FREE").toUpperCase();
    const uid = String(userId || "");
    const count = Number(this.data.autoCountByUser[uid] || 0);
    const limit = t === "PREMIUM"
      ? Number(env.DM_PREMIUM_AUTO_LIMIT || 5)
      : Number(env.DM_FREE_AUTO_LIMIT || 3);
    return count < limit;
  }

  incAuto(userId) {
    this.ensureDay();
    const uid = String(userId || "");
    if (!uid) return 0;
    const next = Number(this.data.autoCountByUser[uid] || 0) + 1;
    this.data.autoCountByUser[uid] = next;
    return next;
  }

  async flush() {
    await writeJsonAtomic(FILE, this.data);
  }
}
