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