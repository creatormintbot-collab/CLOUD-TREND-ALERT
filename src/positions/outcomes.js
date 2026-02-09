export function isWinOutcome(outcome) {
  const o = String(outcome || "").toUpperCase();
  if (!o) return false;

  // Strict rule: SL BEFORE TP1 is a loss.
  if (o.includes("STOP_LOSS_BEFORE_TP1") || o.includes("SL_BEFORE_TP1") || o.includes("BEFORE_TP1")) return false;

  // Any realized profit / TP hit counts as a WIN (≥TP1)
  if (o.startsWith("PROFIT")) return true;
  if (o.includes("TP1") || o.includes("TP2") || o.includes("TP3")) return true;

  // SL after taking profit counts as WIN (giveback).
  if (o.includes("STOP_LOSS_AFTER_TP") || o.includes("SL_AFTER_TP")) return true;

  return false;
}

export const OUTCOME_CLASS = {
  WIN_TP1_PLUS: "WIN_TP1_PLUS",
  LOSS_DIRECT_SL: "LOSS_DIRECT_SL",
  EXPIRED_NO_ENTRY: "EXPIRED_NO_ENTRY",
  OPEN_OR_UNKNOWN: "OPEN_OR_UNKNOWN"
};

function normTag(x) {
  return String(x || "").trim().toUpperCase();
}

function hasAny(str, needles = []) {
  const s = normTag(str);
  if (!s) return false;
  return needles.some((n) => s.includes(n));
}

function flagsFromEvents(events = []) {
  const flags = {
    hasTP1Plus: false,
    hasSL: false,
    hasFilled: false,
    hasExpiredNoEntry: false,
    isClosed: false
  };

  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev) continue;

    const evName = normTag(ev.event || ev.type || ev.name);
    const status = normTag(ev.status);
    const closeOutcome = normTag(ev.closeOutcome);
    const slBeforeTp1 = closeOutcome.includes("BEFORE_TP1") || closeOutcome.includes("SL_BEFORE_TP1") || closeOutcome.includes("STOP_LOSS_BEFORE_TP1");

    if (evName === "TP1" || evName === "TP2" || evName === "TP3") flags.hasTP1Plus = true;
    if (evName === "TP3") flags.isClosed = true;

    if (evName === "SL" || evName === "STOP_LOSS") {
      flags.hasSL = true;
      flags.isClosed = true;
    }

    if (evName === "FILLED") flags.hasFilled = true;

    if (hasAny(evName, ["EXPIRED", "NO_ENTRY", "NOENTRY", "PENDING_TIMEOUT"])) {
      flags.hasExpiredNoEntry = true;
      flags.isClosed = true;
    }

    if (status === "RUNNING") flags.hasFilled = true;
    if (status === "EXPIRED") {
      flags.hasExpiredNoEntry = true;
      flags.isClosed = true;
    }
    if (status === "CLOSED" || status.startsWith("CLOSED")) flags.isClosed = true;

    if (!slBeforeTp1 && hasAny(closeOutcome, ["TP1", "TP2", "TP3"])) flags.hasTP1Plus = true;
    if (hasAny(closeOutcome, ["STOP_LOSS", "SL_"])) {
      flags.hasSL = true;
      flags.isClosed = true;
    }
    if (hasAny(closeOutcome, ["EXPIRED"])) {
      flags.hasExpiredNoEntry = true;
      flags.isClosed = true;
    }

    if (Number(ev.closedAt || 0) > 0) flags.isClosed = true;
  }

  return flags;
}

function flagsFromPos(pos) {
  const flags = {
    hasTP1Plus: false,
    hasSL: false,
    hasFilled: false,
    hasExpiredNoEntry: false,
    isClosed: false
  };

  if (!pos || typeof pos !== "object") return flags;

  const tp = getTpHitMax(pos);
  if (tp >= 1) flags.hasTP1Plus = true;
  const closeOutcome = normTag(pos.closeOutcome);
  const slBeforeTp1 = closeOutcome.includes("BEFORE_TP1") || closeOutcome.includes("SL_BEFORE_TP1") || closeOutcome.includes("STOP_LOSS_BEFORE_TP1");
  if (!slBeforeTp1 && hasAny(closeOutcome, ["TP1", "TP2", "TP3"])) flags.hasTP1Plus = true;

  if (pos.slHit || pos.slHitAt || hasAny(pos.closeOutcome, ["STOP_LOSS", "SL_"])) flags.hasSL = true;

  const status = normTag(pos.status);
  if (pos.filledAt || pos.entryHitAt || status === "RUNNING" || flags.hasTP1Plus) flags.hasFilled = true;

  if (status === "EXPIRED" || hasAny(pos.closeOutcome, ["EXPIRED"])) flags.hasExpiredNoEntry = true;
  if (status === "CLOSED" || status.startsWith("CLOSED") || Number(pos.closedAt || 0) > 0) flags.isClosed = true;

  return flags;
}

export function classifyOutcome({ events = [], pos = null } = {}) {
  const evFlags = flagsFromEvents(events);
  const posFlags = flagsFromPos(pos);

  const flags = {
    hasTP1Plus: evFlags.hasTP1Plus || posFlags.hasTP1Plus,
    hasSL: evFlags.hasSL || posFlags.hasSL,
    hasFilled: evFlags.hasFilled || posFlags.hasFilled,
    hasExpiredNoEntry: evFlags.hasExpiredNoEntry || posFlags.hasExpiredNoEntry,
    isClosed: evFlags.isClosed || posFlags.isClosed
  };

  if (flags.hasExpiredNoEntry && !flags.hasFilled) return OUTCOME_CLASS.EXPIRED_NO_ENTRY;
  if (flags.hasSL && flags.hasTP1Plus) return OUTCOME_CLASS.WIN_TP1_PLUS;
  if (flags.hasSL && !flags.hasTP1Plus) return OUTCOME_CLASS.LOSS_DIRECT_SL;
  if (flags.hasTP1Plus && flags.isClosed) return OUTCOME_CLASS.WIN_TP1_PLUS;
  return OUTCOME_CLASS.OPEN_OR_UNKNOWN;
}

export function getTpHitMax(pos) {
  if (!pos) return 0;
  const v = Number(pos.tpHitMax);
  if (Number.isFinite(v) && v >= 0) return v;
  if (pos.hitTP3) return 3;
  if (pos.hitTP2) return 2;
  if (pos.hitTP1) return 1;
  return 0;
}

export function isGiveback(pos) {
  if (!pos) return false;
  const tp = getTpHitMax(pos);
  const sl = Boolean(pos.slHit) || String(pos.closeOutcome || '').toUpperCase().includes('STOP_LOSS');
  return sl && tp >= 1 && String(pos.status || '').toUpperCase() === 'CLOSED';
}

export function isDirectSL(pos) {
  if (!pos) return false;
  const tp = getTpHitMax(pos);
  const sl = Boolean(pos.slHit) || String(pos.closeOutcome || '').toUpperCase().includes('STOP_LOSS');
  return sl && tp === 0 && String(pos.status || '').toUpperCase() === 'CLOSED';
}

export function getOutcomeBucket(pos) {
  const tp = getTpHitMax(pos);
  if (tp >= 3) return 'TP3';
  if (tp === 2) return 'TP2';
  if (tp === 1) return 'TP1';
  if (isDirectSL(pos)) return 'SL';
  return 'UNKNOWN';
}
