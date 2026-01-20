import { fmtPrice } from "../../utils/format.js";

export function slCard(pos) {
  if (pos.closeOutcome === "STOP_LOSS") {
    return [
      "CLOUD TREND ALERT",
      "━━━━━━━━━━━━━━━━━━",
      "🛑 STOP LOSS HIT",
      `🪙 Pair: ${pos.symbol}`,
      `⏱ Timeframe: ${pos.tf}`,
      "",
      "🎯 Entry Zone:",
      `${fmtPrice(pos.levels.entryLow)} – ${fmtPrice(pos.levels.entryHigh)}`,
      "⚖️ Mid Entry:",
      `${fmtPrice(pos.levels.entryMid)}`,
      "",
      "🛑 Stop Loss Hit:",
      `${fmtPrice(pos.levels.sl)}`,
      "",
      "🧨 Result:",
      "• SL hit before TP1",
      "• Risk managed",
      "",
      "🔴 Status: CLOSED (STOP_LOSS)",
      "━━━━━━━━━━━━━━━━━━"
    ].join("\n");
  }

  if (pos.closeOutcome === "STOP_LOSS_AFTER_TP1") {
    return [
      "CLOUD TREND ALERT",
      "━━━━━━━━━━━━━━━━━━",
      "🛑 PRICE REVERSED — STOP LOSS HIT",
      `🪙 Pair: ${pos.symbol}`,
      `⏱ Timeframe: ${pos.tf}`,
      "",
      "✅ TP1 was hit (partial profit secured)",
      "Price reversed",
      "SL was hit",
      "",
      "🧨 Result:",
      "• TP1 secured partial profit",
      "• SL hit after reversal",
      "",
      "🟢 Status: CLOSED (WIN — PARTIAL / STOP_LOSS_AFTER_TP1)",
      "━━━━━━━━━━━━━━━━━━"
    ].join("\n");
  }

  return [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "🛑 PRICE REVERSED — STOP LOSS HIT",
    `🪙 Pair: ${pos.symbol}`,
    `⏱ Timeframe: ${pos.tf}`,
    "",
    "✅ TP1 & TP2 were hit",
    "Price reversed",
    "SL was hit",
    "",
    "🧨 Result:",
    "• TP1 & TP2 secured partial profit",
    "• SL hit after reversal",
    "",
    "🟢 Status: CLOSED (WIN — PARTIAL / STOP_LOSS_AFTER_TP2)",
    "━━━━━━━━━━━━━━━━━━"
  ].join("\n");
}
