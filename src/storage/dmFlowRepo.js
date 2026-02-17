import path from "node:path";
import { DATA_DIR } from "../config/constants.js";
import { readJson, writeJsonAtomic } from "./jsonStore.js";

const FILE = path.join(DATA_DIR, "dm-flow.json");
const ALLOWED_STAGES = new Set(["NONE", "PLAN_SELECTED", "AWAITING_TXID"]);
const ALLOWED_MONTHS = new Set([1, 6, 12]);

let queue = Promise.resolve();

function normalizeUserId(value) {
  const id = String(value ?? "").trim();
  return id || "";
}

function normalizeIso(value) {
  const iso = String(value || "").trim();
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return new Date().toISOString();
  return new Date(ms).toISOString();
}

function normalizeState(state) {
  if (!state || typeof state !== "object") return null;

  const stage = String(state.stage || "").trim().toUpperCase();
  if (!ALLOWED_STAGES.has(stage)) return null;

  const planMonths = Number(state.planMonths);
  const priceUsd = Number(state.priceUsd);

  const next = {
    stage,
    updatedAtUtc: normalizeIso(state.updatedAtUtc)
  };

  if (ALLOWED_MONTHS.has(planMonths)) next.planMonths = planMonths;
  if (Number.isFinite(priceUsd) && priceUsd >= 0) next.priceUsd = priceUsd;

  return next;
}

function normalizeStore(data) {
  const src = data && typeof data === "object" ? data : {};
  const out = {};

  for (const [rawUserId, rawState] of Object.entries(src)) {
    const userId = normalizeUserId(rawUserId);
    const state = normalizeState(rawState);
    if (!userId || !state) continue;
    out[userId] = state;
  }

  return out;
}

async function readStore() {
  try {
    const data = await readJson(FILE, {});
    return normalizeStore(data);
  } catch {
    return {};
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
    .catch(() => ({}));

  queue = op.then(() => undefined).catch(() => undefined);
  return op;
}

export async function get(userId) {
  const id = normalizeUserId(userId);
  if (!id) return null;

  try {
    const store = await readStore();
    return store[id] || null;
  } catch {
    return null;
  }
}

export async function set(userId, state) {
  const id = normalizeUserId(userId);
  const normalized = normalizeState(state);
  if (!id || !normalized) return null;

  try {
    const store = await enqueueWrite((current) => {
      const next = { ...(current || {}) };
      next[id] = normalized;
      return next;
    });
    return store[id] || null;
  } catch {
    return null;
  }
}

export async function clear(userId) {
  const id = normalizeUserId(userId);
  if (!id) return false;

  try {
    await enqueueWrite((current) => {
      const next = { ...(current || {}) };
      delete next[id];
      return next;
    });
    return true;
  } catch {
    return false;
  }
}
