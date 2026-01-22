export function isWinOutcome(outcome) {
  return outcome === "PROFIT_FULL" || outcome === "STOP_LOSS_AFTER_TP1" || outcome === "STOP_LOSS_AFTER_TP2";
}