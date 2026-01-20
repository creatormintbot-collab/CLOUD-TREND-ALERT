import { STATUS } from "../config/constants.js";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getLevels(pos) {
  const lv = pos?.levels;
  if (!lv || typeof lv !== "object" || Array.isArray(lv)) return null;
  return lv;
}

export function applyTP(pos, price) {
  if (!pos || typeof pos !== "object") return { changed: false };
  if (pos.status === "CLOSED") return { changed: false };

  const p = toNum(price);
  if (p === null) return { changed: false };

  const levels = getLevels(pos);
  if (!levels) return { changed: false }; // <-- ini yang mencegah crash "levels undefined"

  const tp1 = toNum(levels.tp1);
  const tp2 = toNum(levels.tp2);
  const tp3 = toNum(levels.tp3);

  // kalau semua TP invalid, skip (jangan crash)
  if (tp1 === null && tp2 === null && tp3 === null) return { changed: false };

  const hit = (lvl) => (pos.direction === "LONG" ? p >= lvl : p <= lvl);

  if (!pos.hitTP1 && tp1 !== null && hit(tp1)) {
    pos.hitTP1 = true;
    pos.status = STATUS.RUNNING;

    // move SL to BE (LOCKED) — hanya kalau entryMid valid
    const be = toNum(levels.entryMid);
    if (be !== null) pos.slCurrent = be;

    pos.slMode = "BE";
    return { changed: true, event: "TP1" };
  }

  if (!pos.hitTP2 && tp2 !== null && hit(tp2)) {
    pos.hitTP2 = true;
    pos.status = STATUS.RUNNING;
    pos.slMode = "TRAIL";
    return { changed: true, event: "TP2" };
  }

  if (!pos.hitTP3 && tp3 !== null && hit(tp3)) {
    pos.hitTP3 = true;
    pos.status = STATUS.CLOSED;
    pos.closeOutcome = "PROFIT_FULL";
    pos.closedAt = Date.now();
    return { changed: true, event: "TP3" };
  }

  return { changed: false };
}

export function applySL(pos, price) {
  // LOCKED: first line skip CLOSED
  if (!pos || typeof pos !== "object") return { changed: false };
  if (pos.status === "CLOSED") return { changed: false };

  const p = toNum(price);
  if (p === null) return { changed: false };

  const sl = toNum(pos.slCurrent);
  if (sl === null) return { changed: false };

  const slHit = (pos.direction === "LONG") ? (p <= sl) : (p >= sl);
  if (!slHit) return { changed: false };

  pos.status = STATUS.CLOSED;
  pos.closedAt = Date.now();

  if (!pos.hitTP1) pos.closeOutcome = "STOP_LOSS";
  else if (pos.hitTP1 && !pos.hitTP2) pos.closeOutcome = "STOP_LOSS_AFTER_TP1";
  else pos.closeOutcome = "STOP_LOSS_AFTER_TP2";

  return { changed: true, event: "SL" };
}