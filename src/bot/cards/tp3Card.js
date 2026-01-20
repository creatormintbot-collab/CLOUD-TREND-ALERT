import { fmtPrice } from "../../utils/format.js";

export function tp3Card(pos) {
  return [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "🏆 TP3 HIT — CLOSED 100%",
    `🪙 Pair: ${pos.symbol}`,
    `⏱ Timeframe: ${pos.tf}`,
    "",
    "🏆 TP3 Reached:",
    `${fmtPrice(pos.levels.tp3)}`,
    "",
    "🟢 Status: CLOSED (PROFIT_FULL)",
    "━━━━━━━━━━━━━━━━━━",
    "After this: STOP monitoring permanently."
  ].join("\n");
}
