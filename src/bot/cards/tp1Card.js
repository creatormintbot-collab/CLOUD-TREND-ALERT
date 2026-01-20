import { fmtPrice } from "../../utils/format.js";

export function tp1Card(pos) {
  return [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "✅ TP1 HIT — 25%",
    `🪙 Pair: ${pos.symbol}`,
    `⏱ Timeframe: ${pos.tf}`,
    "",
    "🎯 Entry Zone:",
    `${fmtPrice(pos.levels.entryLow)} – ${fmtPrice(pos.levels.entryHigh)}`,
    "⚖️ Mid Entry:",
    `${fmtPrice(pos.levels.entryMid)}`,
    "",
    "✅ TP1 Reached:",
    `${fmtPrice(pos.levels.tp1)}`,
    "",
    "🧷 Action:",
    "• Secure partial profit (25%)",
    "• Move SL to BE",
    "",
    "🛡 Suggested SL (BE):",
    `${fmtPrice(pos.levels.entryMid)}`,
    "",
    "🟡 Status: RUNNING",
    "━━━━━━━━━━━━━━━━━━"
  ].join("\n");
}
