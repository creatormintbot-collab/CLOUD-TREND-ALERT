import { STATUS } from "../config/constants.js";

export function applyTP(pos, price) {
  if (pos.status === "CLOSED") return { changed: false };
  if (pos.status === "PENDING_ENTRY" || pos.status === "EXPIRED") return { changed: false };
  const p = Number(price);

  const tp1 = Number(pos.levels.tp1);
  const tp2 = Number(pos.levels.tp2);
  const tp3 = Number(pos.levels.tp3);

  const hit = (lvl) => (pos.direction === "LONG" ? p >= lvl : p <= lvl);

  if (!pos.hitTP1 && hit(tp1)) {
    pos.hitTP1 = true;
    pos.status = STATUS.RUNNING;
    // move SL to BE (LOCKED)
    pos.slCurrent = Number(pos.levels.entryMid);
    pos.slMode = "BE";
    return { changed: true, event: "TP1" };
  }

  if (!pos.hitTP2 && hit(tp2)) {
    pos.hitTP2 = true;
    pos.status = STATUS.RUNNING;
    // suggested trailing SL left to discretion (we keep current)
    pos.slMode = "TRAIL";
    return { changed: true, event: "TP2" };
  }

  if (!pos.hitTP3 && hit(tp3)) {
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
  if (pos.status === "CLOSED") return { changed: false };
  if (pos.status === "PENDING_ENTRY" || pos.status === "EXPIRED") return { changed: false };

  const p = Number(price);
  const sl = Number(pos.slCurrent);

  const slHit = (pos.direction === "LONG") ? (p <= sl) : (p >= sl);
  if (!slHit) return { changed: false };

  pos.status = STATUS.CLOSED;
  pos.closedAt = Date.now();

  if (!pos.hitTP1) pos.closeOutcome = "STOP_LOSS";
  else if (pos.hitTP1 && !pos.hitTP2) pos.closeOutcome = "STOP_LOSS_AFTER_TP1";
  else pos.closeOutcome = "STOP_LOSS_AFTER_TP2";

  return { changed: true, event: "SL" };
}
