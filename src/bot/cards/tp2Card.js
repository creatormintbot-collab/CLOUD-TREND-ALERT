import { fmtPrice } from "../../utils/format.js";

export function tp2Card(pos) {
  return [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "🔥 TP2 HIT — 50%",
    `🪙 Pair: ${pos.symbol}`,
    `⏱ Timeframe: ${pos.tf}`,
    "",
    "🔥 TP2 Reached:",
    `${fmtPrice(pos.levels.tp2)}`,
    "",
    "🧷 Action:",
    "• Lock more profit (50% total)",
    "• Trail SL (discretion)",
    "",
    "🛡 Suggested SL:",
    `${fmtPrice(pos.slCurrent)}`,
    "",
    "🟡 Status: RUNNING",
    "━━━━━━━━━━━━━━━━━━"
  ].join("\n");
}
