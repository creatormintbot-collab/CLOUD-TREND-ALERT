import { ENV } from "../../config/env.js";

export function buildDailyRecapCard({ utcDate, stats }) {
  const html = [
    `📊 <b>${ENV.BOT_NAME} — Daily Recap</b>`,
    `<b>(UTC ${utcDate})</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `• Total signals: <b>${stats.total}</b>`,
    `• Per timeframe: ${stats.perTf}`,
    `• Avg score: <b>${stats.avgScore.toFixed(1)}%</b>`,
    `• 4h filtered count: <b>${stats.filtered4h}</b>`,
    `• Macro summary: RISK_ON=${stats.macro.riskOn}, RISK_OFF=${stats.macro.riskOff}, NEUTRAL=${stats.macro.neutral}`,
    `━━━━━━━━━━━━━━━━━━`,
    `<b>Top 5 by score</b>`,
    ...stats.top5.map((s) => `• ${s.symbol} ${s.timeframe} ${s.direction} — ${Math.round(s.score)}%`),
    `━━━━━━━━━━━━━━━━━━`,
    `⚠️ <i>Not Financial Advice</i>`,
  ].join("\n");

  return { html };
}
