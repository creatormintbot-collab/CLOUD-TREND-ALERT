import path from "node:path";
import { DATA_DIR } from "../config/constants.js";
import { readJson, writeJsonAtomic } from "./jsonStore.js";

const FILE = path.join(DATA_DIR, "users.json");

export class UsersRepo {
  constructor() {
    this.data = { users: {} };
  }

  async load() {
    const loaded = await readJson(FILE, { users: {} });
    if (!loaded || typeof loaded !== "object") this.data = { users: {} };
    else {
      this.data = loaded;
      if (!this.data.users || typeof this.data.users !== "object") this.data.users = {};
    }
    await writeJsonAtomic(FILE, this.data);
    return this.data;
  }

  upsertUser(userId, meta = {}) {
    const uid = String(userId || "").trim();
    if (!uid) return null;
    const now = new Date().toISOString();
    const existing = this.data.users[uid] || {};
    this.data.users[uid] = { ...existing, ...meta, userId: uid, updatedAt: now };
    return this.data.users[uid];
  }

  listUserIds() {
    return Object.keys(this.data.users || {});
  }

  async flush() {
    await writeJsonAtomic(FILE, this.data);
  }
}
