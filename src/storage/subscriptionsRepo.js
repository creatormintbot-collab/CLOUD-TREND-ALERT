import path from "node:path";
import { DATA_DIR } from "../config/constants.js";
import { readJson, writeJsonAtomic } from "./jsonStore.js";

const FILE = path.join(DATA_DIR, "subscriptions.json");
const ALLOWED_STATUS = new Set(["pending", "active", "expired"]);
const ALLOWED_MONTHS = new Set([1, 6, 12]);
const PRICE_BY_MONTHS = { 1: 10, 6: 45, 12: 60 };

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

function normalizeIsoOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const iso = String(value || "").trim();
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function normalizeSubscription(raw) {
  if (!raw || typeof raw !== "object") return null;

  const status = String(raw.status || "").trim().toLowerCase();
  if (!ALLOWED_STATUS.has(status)) return null;

  const planMonths = Number(raw.planMonths);
  if (!ALLOWED_MONTHS.has(planMonths)) return null;

  const priceRaw = Number(raw.priceUsd);
  const priceUsd = Number.isFinite(priceRaw) && priceRaw >= 0
    ? priceRaw
    : (PRICE_BY_MONTHS[planMonths] ?? 0);

  const txid = String(raw.txid || "").trim();
  const requestedAtUtc = normalizeIso(raw.requestedAtUtc);
  const approvedAtUtc = normalizeIsoOrNull(raw.approvedAtUtc);
  const expiresAtUtc = normalizeIsoOrNull(raw.expiresAtUtc);

  const approvedByRaw = String(raw.approvedBy || "").trim();
  const approvedBy = approvedByRaw || null;

  return {
    status,
    planMonths,
    priceUsd,
    txid,
    requestedAtUtc,
    approvedAtUtc,
    expiresAtUtc,
    approvedBy
  };
}

function normalizeStore(data) {
  const src = data && typeof data === "object" ? data : {};
  const out = {};

  for (const [rawUserId, rawSub] of Object.entries(src)) {
    const userId = normalizeUserId(rawUserId);
    const sub = normalizeSubscription(rawSub);
    if (!userId || !sub) continue;
    out[userId] = sub;
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

export async function setPending({ userId, planMonths, priceUsd, txid, requestedAtUtc }) {
  const id = normalizeUserId(userId);
  const months = Number(planMonths);
  if (!id || !ALLOWED_MONTHS.has(months)) return null;

  const price = Number(priceUsd);
  const safePrice = Number.isFinite(price) && price >= 0 ? price : (PRICE_BY_MONTHS[months] ?? 0);

  const nextSub = normalizeSubscription({
    status: "pending",
    planMonths: months,
    priceUsd: safePrice,
    txid: String(txid || "").trim(),
    requestedAtUtc: requestedAtUtc || new Date().toISOString(),
    approvedAtUtc: null,
    expiresAtUtc: null,
    approvedBy: null
  });

  if (!nextSub) return null;

  try {
    const store = await enqueueWrite((current) => {
      const next = { ...(current || {}) };
      next[id] = nextSub;
      return next;
    });
    return store[id] || null;
  } catch {
    return null;
  }
}

export async function approve({ userId, planMonths, approvedBy, approvedAtUtc, expiresAtUtc }) {
  const id = normalizeUserId(userId);
  const months = Number(planMonths);
  if (!id || !ALLOWED_MONTHS.has(months)) return null;

  const approvedIso = normalizeIso(approvedAtUtc || new Date().toISOString());
  const expiresIso = normalizeIsoOrNull(expiresAtUtc);
  if (!expiresIso) return null;

  const approvedByText = String(approvedBy || "").trim() || null;

  try {
    const store = await enqueueWrite((current) => {
      const next = { ...(current || {}) };
      const prev = normalizeSubscription(next[id]) || null;

      const priceUsd = Number.isFinite(Number(prev?.priceUsd))
        ? Number(prev.priceUsd)
        : (PRICE_BY_MONTHS[months] ?? 0);

      next[id] = {
        status: "active",
        planMonths: months,
        priceUsd,
        txid: String(prev?.txid || "").trim(),
        requestedAtUtc: prev?.requestedAtUtc || approvedIso,
        approvedAtUtc: approvedIso,
        expiresAtUtc: expiresIso,
        approvedBy: approvedByText
      };

      return next;
    });

    return store[id] || null;
  } catch {
    return null;
  }
}

export async function isPremiumActive(userId) {
  const id = normalizeUserId(userId);
  if (!id) return false;

  try {
    const current = await readStore();
    const sub = current[id];
    if (!sub || sub.status !== "active") return false;

    const expiresMs = Date.parse(String(sub.expiresAtUtc || ""));
    if (!Number.isFinite(expiresMs)) {
      await enqueueWrite((store) => {
        const next = { ...(store || {}) };
        const latest = normalizeSubscription(next[id]);
        if (!latest || latest.status !== "active") return next;

        const latestExpiresMs = Date.parse(String(latest.expiresAtUtc || ""));
        if (!Number.isFinite(latestExpiresMs)) {
          next[id] = { ...latest, status: "expired" };
        }
        return next;
      });
      return false;
    }

    if (expiresMs > Date.now()) return true;

    await enqueueWrite((store) => {
      const next = { ...(store || {}) };
      const latest = normalizeSubscription(next[id]);
      if (!latest || latest.status !== "active") return next;

      const latestExpiresMs = Date.parse(String(latest.expiresAtUtc || ""));
      if (Number.isFinite(latestExpiresMs) && latestExpiresMs <= Date.now()) {
        next[id] = { ...latest, status: "expired" };
      }
      return next;
    });

    return false;
  } catch {
    return false;
  }
}

export async function getExpiry(userId) {
  const id = normalizeUserId(userId);
  if (!id) return null;

  const active = await isPremiumActive(id);
  if (!active) return null;

  const sub = await get(id);
  return sub?.expiresAtUtc || null;
}
