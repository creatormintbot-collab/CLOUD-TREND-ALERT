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
