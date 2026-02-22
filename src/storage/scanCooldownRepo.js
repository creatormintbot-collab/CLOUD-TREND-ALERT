import path from "node:path";
import { DATA_DIR } from "../config/constants.js";
import { readJson, writeJsonAtomic } from "./jsonStore.js";

const FILE = path.join(DATA_DIR, "scan-cooldown.json");
const MODES = new Set(["DISCOVERY", "TARGETED"]);

let queue = Promise.resolve();

function normalizeUserId(value) {
  const id = String(value ?? "").trim();
  return id || "";
}

function normalizeMode(value) {
  const mode = String(value ?? "").trim().toUpperCase();
  return MODES.has(mode) ? mode : "";
}

function normalizeTimestamp(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function normalizeStore(data) {
  const src = data && typeof data === "object" ? data : {};
  const out = { DISCOVERY: {}, TARGETED: {} };

  for (const mode of MODES) {
    const bucket = src[mode];
    if (!bucket || typeof bucket !== "object") continue;
    for (const [rawUserId, rawTs] of Object.entries(bucket)) {
      const userId = normalizeUserId(rawUserId);
      const ts = normalizeTimestamp(rawTs);
      if (!userId || !ts) continue;
      out[mode][userId] = ts;
    }
  }

  return out;
}

async function readStore() {
  try {
    const data = await readJson(FILE, {});
    return normalizeStore(data);
  } catch {
    return { DISCOVERY: {}, TARGETED: {} };
  }
}

async function enqueueWrite(mutator) {
  const op = queue
    .then(async () => {
      const current = await readStore();
      const next = await mutator(current);
      const safe = normalizeStore(next);
      await writeJsonAtomic(FILE, safe);
      return safe;
    })
    .catch(() => ({ DISCOVERY: {}, TARGETED: {} }));

  queue = op.then(() => undefined).catch(() => undefined);
  return op;
}

export async function get(userId, mode) {
  const id = normalizeUserId(userId);
  const m = normalizeMode(mode);
  if (!id || !m) return 0;

  try {
    const store = await readStore();
    return normalizeTimestamp(store?.[m]?.[id] || 0);
  } catch {
    return 0;
  }
}

export async function set(userId, mode, ts = Date.now()) {
  const id = normalizeUserId(userId);
  const m = normalizeMode(mode);
  const stamp = normalizeTimestamp(ts);
  if (!id || !m || !stamp) return 0;

  try {
    const store = await enqueueWrite((current) => {
      const next = { ...(current || {}) };
      const bucket = { ...(next[m] || {}) };
      bucket[id] = stamp;
      next[m] = bucket;
      return next;
    });
    return normalizeTimestamp(store?.[m]?.[id] || 0);
  } catch {
    return 0;
  }
}

export async function clear(userId, mode) {
  const id = normalizeUserId(userId);
  const m = normalizeMode(mode);
  if (!id) return false;

  try {
    await enqueueWrite((current) => {
      const next = { ...(current || {}) };
      if (m) {
        const bucket = { ...(next[m] || {}) };
        delete bucket[id];
        next[m] = bucket;
      } else {
        for (const modeKey of MODES) {
          const bucket = { ...(next[modeKey] || {}) };
          delete bucket[id];
          next[modeKey] = bucket;
        }
      }
      return next;
    });
    return true;
  } catch {
    return false;
  }
}
