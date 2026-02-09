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

function tpFromTag(tag) {
  const t = normTag(tag);
  if (!t) return 0;
  if (t.includes("TP3")) return 3;
  if (t.includes("TP2")) return 2;
  if (t.includes("TP1")) return 1;
  return 0;
}

function baseFlags() {
  return {
    maxTpHit: 0,
    hasTP1Plus: false,
    hasSL: false,
    hasEntry: false,
    isExpired: false
  };
}

function applyTp(flags, tp) {
  const v = Number(tp);
  if (!Number.isFinite(v) || v <= 0) return;
  flags.maxTpHit = Math.max(flags.maxTpHit, v);
  if (flags.maxTpHit >= 1) flags.hasTP1Plus = true;
}

function flagsFromEvents(events = []) {
  const flags = baseFlags();

  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev) continue;

    const evName = normTag(ev.event || ev.type || ev.name);
    const status = normTag(ev.status);
    const closeOutcome = normTag(ev.closeOutcome);
    const slBeforeTp1 = closeOutcome.includes("BEFORE_TP1") || closeOutcome.includes("SL_BEFORE_TP1") || closeOutcome.includes("STOP_LOSS_BEFORE_TP1");

    if (evName === "TP1") applyTp(flags, 1);
    if (evName === "TP2") applyTp(flags, 2);
    if (evName === "TP3") applyTp(flags, 3);

    if (ev?.hit?.tp1) applyTp(flags, 1);
    if (ev?.hit?.tp2) applyTp(flags, 2);
    if (ev?.hit?.tp3) applyTp(flags, 3);

    if (evName === "SL" || evName === "STOP_LOSS") flags.hasSL = true;
    if (evName === "FILLED" || evName === "ENTRY" || evName === "ENTRY_FILLED") flags.hasEntry = true;
    if (hasAny(evName, ["EXPIRED", "NO_ENTRY", "NOENTRY", "PENDING_TIMEOUT"])) flags.isExpired = true;

    if (status === "RUNNING" || status === "FILLED") flags.hasEntry = true;
    if (status === "EXPIRED") flags.isExpired = true;

    if (!slBeforeTp1) applyTp(flags, tpFromTag(closeOutcome));
    if (hasAny(closeOutcome, ["STOP_LOSS", "SL_"])) flags.hasSL = true;
    if (hasAny(closeOutcome, ["EXPIRED"])) flags.isExpired = true;
  }

  if (flags.maxTpHit >= 1) flags.hasEntry = true;
  return flags;
}

function flagsFromPos(pos) {
  const flags = baseFlags();

  if (!pos || typeof pos !== "object") return flags;

  const tp = getTpHitMax(pos);
  applyTp(flags, tp);

  const closeOutcome = normTag(pos.closeOutcome);
  const slBeforeTp1 = closeOutcome.includes("BEFORE_TP1") || closeOutcome.includes("SL_BEFORE_TP1") || closeOutcome.includes("STOP_LOSS_BEFORE_TP1");
  if (!slBeforeTp1) applyTp(flags, tpFromTag(closeOutcome));

  if (pos.slHit || pos.slHitAt || hasAny(pos.closeOutcome, ["STOP_LOSS", "SL_"])) flags.hasSL = true;

  const status = normTag(pos.status);
  if (pos.filledAt || pos.entryHitAt || status === "RUNNING" || flags.hasTP1Plus) flags.hasEntry = true;

  if (status === "EXPIRED" || pos.expiredAt || hasAny(pos.closeOutcome, ["EXPIRED"])) flags.isExpired = true;

  if (flags.maxTpHit >= 1) flags.hasEntry = true;
  return flags;
}

export function classifyOutcomeFromEvents(eventsForPosition = [], pos = null) {
  const evFlags = flagsFromEvents(eventsForPosition);
  const posFlags = flagsFromPos(pos);

  const flags = {
    maxTpHit: Math.max(evFlags.maxTpHit, posFlags.maxTpHit),
    hasTP1Plus: evFlags.hasTP1Plus || posFlags.hasTP1Plus,
    hasSL: evFlags.hasSL || posFlags.hasSL,
    hasEntry: evFlags.hasEntry || posFlags.hasEntry,
    isExpired: evFlags.isExpired || posFlags.isExpired
  };

  if (flags.maxTpHit >= 1) flags.hasTP1Plus = true;
  if (flags.hasTP1Plus) flags.hasEntry = true;

  let outcomeType = OUTCOME_CLASS.OPEN_OR_UNKNOWN;
  if (flags.isExpired && !flags.hasEntry) outcomeType = OUTCOME_CLASS.EXPIRED_NO_ENTRY;
  else if (flags.hasSL && !flags.hasTP1Plus) outcomeType = OUTCOME_CLASS.LOSS_DIRECT_SL;
  else if (flags.hasTP1Plus) outcomeType = OUTCOME_CLASS.WIN_TP1_PLUS;

  return {
    outcomeType,
    maxTpHit: flags.maxTpHit,
    hasEntry: flags.hasEntry,
    isExpired: flags.isExpired,
    hasTP1Plus: flags.hasTP1Plus,
    hasSL: flags.hasSL
  };
}

export function classifyOutcome({ events = [], pos = null } = {}) {
  return classifyOutcomeFromEvents(events, pos).outcomeType;
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
