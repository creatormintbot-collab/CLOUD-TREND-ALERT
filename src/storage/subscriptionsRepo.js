import path from "node:path";
import { DATA_DIR } from "../config/constants.js";
import { readJson, writeJsonAtomic } from "./jsonStore.js";

const FILE = path.join(DATA_DIR, "subscriptions.json");

function parseExpiresMs(expiresAt) {
  const ms = Date.parse(String(expiresAt || ""));
  return Number.isFinite(ms) ? ms : 0;
}

export class SubscriptionsRepo {
  constructor() {
    this.data = {};
  }

  async load() {
    const loaded = await readJson(FILE, {});
    this.data = (loaded && typeof loaded === "object") ? loaded : {};
    await writeJsonAtomic(FILE, this.data);
    return this.data;
  }

  get(userId) {
    if (!userId && userId !== 0) return null;
    return this.data[String(userId)] || null;
  }

  getTier(userId) {
    const rec = this.get(userId);
    if (!rec || !rec.tier) return "FREE";
    const tier = String(rec.tier || "FREE").toUpperCase();
    const expMs = parseExpiresMs(rec.expiresAt);
    if (!Number.isFinite(expMs) || expMs <= Date.now()) return "FREE";
    return tier === "PREMIUM" ? "PREMIUM" : "FREE";
  }

  grant(userId, days) {
    const uid = String(userId || "").trim();
    const n = Number(days);
    if (!uid || !Number.isFinite(n) || n <= 0) return null;
    const expMs = Date.now() + Math.round(n * 86400000);
    const expiresAt = new Date(expMs).toISOString();
    this.data[uid] = { tier: "PREMIUM", expiresAt };
    return this.data[uid];
  }

  revoke(userId) {
    const uid = String(userId || "").trim();
    if (!uid) return false;
    if (this.data[uid]) delete this.data[uid];
    return true;
  }

  async flush() {
    await writeJsonAtomic(FILE, this.data);
  }
}
