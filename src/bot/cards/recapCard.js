import { fmtScore } from "../../utils/format.js";

export function recapCard(x) {
  return [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "📊 DAILY FUTURES RECAP",
    `🗓 Date: ${x.dateKey} (UTC)`,
    "",
    `🤖 AUTO Signals: ${x.autoTotal}`,
    `🧠 /scan Requests: ${x.scanTotal}`,
    "",
    "⏱ Timeframe Breakdown:",
    `15m: ${x.tfBreakdown["15m"]} | 30m: ${x.tfBreakdown["30m"]} | 1h: ${x.tfBreakdown["1h"]} | 4h: ${x.tfBreakdown["4h"]}`,
    "",
    `🏆 Top Score: ${fmtScore(x.topScore)}`,
    `📈 Avg Score: ${Number(x.avgScore || 0).toFixed(2)}`,
    "",
    `✅ WIN: ${x.win}`,
    `❌ LOSE: ${x.lose}`,
    "",
    "🌍 Macro Summary:",
    `${x.macroSummary}`,
    "━━━━━━━━━━━━━━━━━━",
    "⚠️ Not Financial Advice"
  ].join("\n");
}
