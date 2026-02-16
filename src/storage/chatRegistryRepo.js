import path from "node:path";
import { DATA_DIR } from "../config/constants.js";
import { readJson, writeJsonAtomic } from "./jsonStore.js";

const FILE = path.join(DATA_DIR, "chat-registry.json");

function normalizeChatRecord(chat) {
  if (!chat || chat.id === undefined || chat.id === null) return null;

  const id = String(chat.id);
  const type = chat.type ? String(chat.type) : "";
  let title = chat.title;

  if (!title) {
    const parts = [chat.first_name, chat.last_name].filter(Boolean);
    title = parts.join(" ").trim();
  }

  const username = chat.username ? String(chat.username) : "";

  return {
    id,
    type,
    title: title || "",
    username
  };
}

export class ChatRegistryRepo {
  constructor() {
    this.file = FILE;
    this._map = new Map();
    this._loaded = false;
    this._queue = Promise.resolve();
  }

  _serialize() {
    return Array.from(this._map.values()).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  async load() {
    try {
      const data = await readJson(this.file, []);
      const list = Array.isArray(data)
        ? data
        : (data && typeof data === "object" ? Object.values(data) : []);

      for (const raw of list) {
        if (!raw || raw.id === undefined || raw.id === null) continue;
        const id = String(raw.id);
        this._map.set(id, {
          id,
          type: raw.type ? String(raw.type) : "",
          title: raw.title ? String(raw.title) : "",
          username: raw.username ? String(raw.username) : "",
          firstSeenAt: raw.firstSeenAt ? String(raw.firstSeenAt) : "",
          lastSeenAt: raw.lastSeenAt ? String(raw.lastSeenAt) : ""
        });
      }
    } catch {}

    this._loaded = true;
    return this._serialize();
  }

  upsert(chat) {
    const base = normalizeChatRecord(chat);
    if (!base) return null;

    const now = new Date().toISOString();
    const existing = this._map.get(base.id);

    const next = existing
      ? {
          ...existing,
          ...base,
          firstSeenAt: existing.firstSeenAt || now,
          lastSeenAt: now
        }
      : {
          ...base,
          firstSeenAt: now,
          lastSeenAt: now
        };

    this._map.set(base.id, next);

    this._queue = this._queue
      .then(() => writeJsonAtomic(this.file, this._serialize()))
      .catch(() => {});

    return next;
  }
}
