import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../config/constants.js";

const GROUPS_DIR = path.join(DATA_DIR, "groups");
const INC_QUEUES = new Map();

function defaultStats() {
  return {
    scanRequestsSuccess: 0,
    scanSignalsSent: 0,
    autoSignalsSent: 0,
    dmScanUsed: 0
  };
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeStats(stats) {
  const s = stats && typeof stats === "object" ? stats : {};
  return {
    scanRequestsSuccess: toNum(s.scanRequestsSuccess),
    scanSignalsSent: toNum(s.scanSignalsSent),
    autoSignalsSent: toNum(s.autoSignalsSent),
    dmScanUsed: toNum(s.dmScanUsed)
  };
}

function safeChatId(chatId) {
  const raw = String(chatId ?? "").trim();
  if (!raw) return "unknown";
  return raw.replace(/[\\/]/g, "_");
}

function statsFile(chatId, dateKey) {
  const dir = path.join(GROUPS_DIR, safeChatId(chatId));
  const key = String(dateKey || "").trim();
  return path.join(dir, `stats-${key}.json`);
}

function incQueueKey(chatId, dateKey) {
  return `${safeChatId(chatId)}:${String(dateKey || "").trim()}`;
}

export async function ensureGroupDir(chatId) {
  const dir = path.join(GROUPS_DIR, safeChatId(chatId));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function readDay(chatId, dateKey) {
  const file = statsFile(chatId, dateKey);
  try {
    const txt = await fs.readFile(file, "utf8");
    return normalizeStats(JSON.parse(txt));
  } catch {
    return defaultStats();
  }
}

export async function writeDay(chatId, dateKey, obj) {
  const dir = await ensureGroupDir(chatId);
  const key = String(dateKey || "").trim();
  const file = path.join(dir, `stats-${key}.json`);
  const data = normalizeStats(obj);
  const txt = JSON.stringify(data, null, 2);
  await fs.writeFile(file, txt, "utf8");
  return data;
}

export async function inc(chatId, dateKey, key, delta = 1) {
  const statKey = String(key || "").trim();
  if (!statKey) return null;

  const queueKey = incQueueKey(chatId, dateKey);
  const prev = INC_QUEUES.get(queueKey) || Promise.resolve();

  const nextOp = prev
    .catch(() => undefined)
    .then(async () => {
      const data = await readDay(chatId, dateKey);
      const next = { ...data };
      const add = toNum(delta);
      next[statKey] = toNum(next[statKey]) + add;
      await writeDay(chatId, dateKey, next);
      return next;
    });

  INC_QUEUES.set(queueKey, nextOp.finally(() => {
    if (INC_QUEUES.get(queueKey) === nextOp) INC_QUEUES.delete(queueKey);
  }));

  return nextOp;
}

export async function consumeDailyQuota(chatId, dateKey, key, max) {
  const statKey = String(key || "").trim();
  const cap = Math.max(0, Math.floor(Number(max)));
  if (!statKey || !Number.isFinite(cap)) return { ok: false, used: 0, max: cap || 0, nextUsed: 0 };

  const queueKey = incQueueKey(chatId, dateKey);
  const prev = INC_QUEUES.get(queueKey) || Promise.resolve();

  const nextOp = prev
    .catch(() => undefined)
    .then(async () => {
      const data = await readDay(chatId, dateKey);
      const next = { ...data };
      const used = toNum(next[statKey]);

      if (used >= cap) return { ok: false, used, max: cap, nextUsed: used };

      const usedAfter = used + 1;
      next[statKey] = usedAfter;
      await writeDay(chatId, dateKey, next);
      return { ok: true, used, max: cap, nextUsed: usedAfter };
    });

  INC_QUEUES.set(queueKey, nextOp.finally(() => {
    if (INC_QUEUES.get(queueKey) === nextOp) INC_QUEUES.delete(queueKey);
  }));

  return nextOp;
}

export async function readRange(chatId, dateKeys = []) {
  const keys = Array.isArray(dateKeys) ? dateKeys : [];
  const totals = defaultStats();
  const days = {};

  for (const key of keys) {
    const day = await readDay(chatId, key);
    days[key] = day;
    totals.scanRequestsSuccess += toNum(day.scanRequestsSuccess);
    totals.scanSignalsSent += toNum(day.scanSignalsSent);
    totals.autoSignalsSent += toNum(day.autoSignalsSent);
    totals.dmScanUsed += toNum(day.dmScanUsed);
  }

  return { totals, days };
}
