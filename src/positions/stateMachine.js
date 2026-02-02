import { STATUS } from "../config/constants.js";

function ensureTpHitMax(pos) {
  if (!pos) return 0;
  const v = Number(pos.tpHitMax);
  if (Number.isFinite(v) && v >= 0) return v;
  if (pos.hitTP3) return 3;
  if (pos.hitTP2) return 2;
  if (pos.hitTP1) return 1;
  return 0;
}

function tfToMs(tf) {
  const t = String(tf || "").trim().toLowerCase();
  if (!t) return 0;
  const m = t.match(/^(\d+)([mhd])$/);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (m[2] === "m") return n * 60 * 1000;
  if (m[2] === "h") return n * 60 * 60 * 1000;
  if (m[2] === "d") return n * 24 * 60 * 60 * 1000;
  return 0;
}

function candleBucket(ms, tf) {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) return null;
  const step = tfToMs(tf);
  if (!step) return null;
  return Math.floor(t / step) * step;
}

function beOffsetSL(pos) {
  const entry = Number(pos?.levels?.entryMid);
  const sl0 = Number(pos?.slInitial ?? pos?.levels?.sl);
  if (!Number.isFinite(entry) || !Number.isFinite(sl0)) return entry;
  const R = Math.abs(entry - sl0);
  const delta = 0.10 * R;
  if (!Number.isFinite(delta) || delta <= 0) return entry;
  const dir = String(pos?.direction || "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  return dir === "LONG" ? (entry + delta) : (entry - delta);
}


export function applyTP(pos, price) {
  if (pos.status === "CLOSED") return { changed: false };
  if (pos.status === "PENDING_ENTRY" || pos.status === "EXPIRED") return { changed: false };
  const p = Number(price);
  const nowMs = Date.now();
  // Backward-compatible: derive tpHitMax from legacy flags if missing.
  pos.tpHitMax = ensureTpHitMax(pos);

  const tp1 = Number(pos.levels.tp1);
  const tp2 = Number(pos.levels.tp2);
  const tp3 = Number(pos.levels.tp3);

  const hit = (lvl) => (pos.direction === "LONG" ? p >= lvl : p <= lvl);

  if (!pos.hitTP1 && hit(tp1)) {
    pos.hitTP1 = true;
    pos.tp1HitAt = nowMs;
    pos.tpHitMax = Math.max(ensureTpHitMax(pos), 1);
    pos.status = STATUS.RUNNING;
    // move SL to BE ± 0.10R (LOCKED)
    pos.slCurrent = beOffsetSL(pos);
    pos.slMode = "BE";
    return { changed: true, event: "TP1" };
  }

  if (!pos.hitTP2 && hit(tp2)) {
    pos.hitTP2 = true;
    pos.tp2HitAt = nowMs;
    pos.tpHitMax = Math.max(ensureTpHitMax(pos), 2);
    pos.status = STATUS.RUNNING;
    // suggested trailing SL left to discretion (we keep current)
    pos.slMode = "TRAIL";
    return { changed: true, event: "TP2" };
  }

  if (!pos.hitTP3 && hit(tp3)) {
    pos.hitTP3 = true;
    pos.tp3HitAt = nowMs;
    pos.tpHitMax = 3;
    pos.status = STATUS.CLOSED;
    pos.closeOutcome = "PROFIT_FULL";
    pos.closedAt = Date.now();
    return { changed: true, event: "TP3" };
  }

  return { changed: false };
}

export function applySL(pos, price) {
  // LOCKED: first line skip CLOSED
  if (pos.status === "CLOSED") return { changed: false };
  if (pos.status === "PENDING_ENTRY" || pos.status === "EXPIRED") return { changed: false };

  const p = Number(price);
  const sl = Number(pos.slCurrent);
  // Backward-compatible: derive tpHitMax from legacy flags if missing.
  pos.tpHitMax = ensureTpHitMax(pos);

  const slHit = (pos.direction === "LONG") ? (p <= sl) : (p >= sl);
  if (!slHit) return { changed: false };

  pos.status = STATUS.CLOSED;
  const nowMs = Date.now();
  pos.closedAt = nowMs;
  pos.slHit = true;
  pos.slHitAt = nowMs;

  const slBucket = candleBucket(nowMs, pos.tf);
  const tp1Bucket = candleBucket(pos?.tp1HitAt, pos.tf);
  const tp2Bucket = candleBucket(pos?.tp2HitAt, pos.tf);

  const tp1Confirmed =
    pos.hitTP1 &&
    (tp1Bucket === null || slBucket === null || tp1Bucket < slBucket);
  const tp2Confirmed =
    pos.hitTP2 &&
    (tp2Bucket === null || slBucket === null || tp2Bucket < slBucket);

  // If TP hits occurred only within the same candle as SL, treat as unconfirmed (conservative).
  if (!tp1Confirmed) {
    pos.hitTP1 = false;
    pos.tp1HitAt = null;
  }
  if (!tp2Confirmed) {
    pos.hitTP2 = false;
    pos.tp2HitAt = null;
  }

  pos.tpHitMax = tp2Confirmed ? 2 : (tp1Confirmed ? 1 : 0);

  if (!tp1Confirmed) {
    pos.closeOutcome = (tp1Bucket !== null && slBucket !== null && tp1Bucket === slBucket)
      ? "STOP_LOSS_BEFORE_TP1_AMBIGUOUS"
      : "STOP_LOSS_BEFORE_TP1";
  } else if (!tp2Confirmed) {
    pos.closeOutcome = "STOP_LOSS_AFTER_TP1";
  } else {
    pos.closeOutcome = "STOP_LOSS_AFTER_TP2";
  }

  return { changed: true, event: "SL" };
}
