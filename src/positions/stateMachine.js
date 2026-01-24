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

export function applyTP(pos, price) {
  if (pos.status === "CLOSED") return { changed: false };
  if (pos.status === "PENDING_ENTRY" || pos.status === "EXPIRED") return { changed: false };
  const p = Number(price);
  // Backward-compatible: derive tpHitMax from legacy flags if missing.
  pos.tpHitMax = ensureTpHitMax(pos);

  const tp1 = Number(pos.levels.tp1);
  const tp2 = Number(pos.levels.tp2);
  const tp3 = Number(pos.levels.tp3);

  const hit = (lvl) => (pos.direction === "LONG" ? p >= lvl : p <= lvl);

  if (!pos.hitTP1 && hit(tp1)) {
    pos.hitTP1 = true;
    pos.tpHitMax = Math.max(ensureTpHitMax(pos), 1);
    pos.status = STATUS.RUNNING;
    // move SL to BE (LOCKED)
    pos.slCurrent = Number(pos.levels.entryMid);
    pos.slMode = "BE";
    return { changed: true, event: "TP1" };
  }

  if (!pos.hitTP2 && hit(tp2)) {
    pos.hitTP2 = true;
    pos.tpHitMax = Math.max(ensureTpHitMax(pos), 2);
    pos.status = STATUS.RUNNING;
    // suggested trailing SL left to discretion (we keep current)
    pos.slMode = "TRAIL";
    return { changed: true, event: "TP2" };
  }

  if (!pos.hitTP3 && hit(tp3)) {
    pos.hitTP3 = true;
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

  if (!pos.hitTP1) pos.closeOutcome = "STOP_LOSS_BEFORE_TP1";
  else if (pos.hitTP1 && !pos.hitTP2) pos.closeOutcome = "STOP_LOSS_AFTER_TP1";
  else pos.closeOutcome = "STOP_LOSS_AFTER_TP2";

  return { changed: true, event: "SL" };
}