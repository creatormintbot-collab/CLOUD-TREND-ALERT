import { fmtScore } from "../../utils/format.js";

function num(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

function tfLine(tfObj, fallbackObj) {
  const o = tfObj || fallbackObj || {};
  const v = (k) => num(o[k], 0);
  return `15m: ${v("15m")} | 30m: ${v("30m")} | 1h: ${v("1h")} | 4h: ${v("4h")}`;
}

export function recapCard(x = {}) {
  const dateKey = x.dateKey || x.dateUTC || x.dayKey || "N/A";

  // Activity (Created Today)
  const autoSent = num(x.autoSignalsSent, num(x.autoTotal, 0));
  const scanReq = num(x.scanRequests, num(x.scanTotal, 0));
  const scanSent = num(x.scanSignalsSent, num(x.scanSent, 0));
  const totalSent = num(x.totalSignalsSent, (autoSent + scanSent));

  // Signals-sent breakdown by timeframe (prefer correct field)
  const tfBreakdownSent = x.tfBreakdownSent || x.tfBreakdownSignals || null;
  const tfBreakdownLegacy = x.tfBreakdown || { "15m": 0, "30m": 0, "1h": 0, "4h": 0 };

  // Entry status (active)
  const pendingEntry = num(x.pendingEntry, 0);
  const openTrades = num(x.filledOpen, num(x.openTrades, 0));
  const expiredToday = num(x.expiredToday, 0);

  // Results (Closed Today)
  const win = num(x.win, 0);
  const lose = num(x.lose, 0);
  const giveback = num(x.giveback, 0);
  const closedTrades = num(x.closedTrades, (win + lose));

  const winTp1 = num(x.winTp1Max, num(x.winTp1, 0));
  const winTp2 = num(x.winTp2Max, num(x.winTp2, 0));
  const winTp3 = num(x.winTp3Max, num(x.winTp3, 0));

  // Score summary (optional, backwards-compatible)
  const topScore = (x.topScore !== undefined) ? fmtScore(x.topScore) : null;
  const avgScore = (x.avgScore !== undefined) ? Number(num(x.avgScore, 0)).toFixed(2) : null;

  const winrate = closedTrades > 0 ? ((win / closedTrades) * 100).toFixed(1) : "0.0";
  const slRate = closedTrades > 0 ? ((lose / closedTrades) * 100).toFixed(1) : "0.0";

  const macroSummary = x.macroSummary || "BTC: N/A | ALTS: N/A | Bias: N/A";

  const lines = [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "📊 DAILY FUTURES RECAP (UTC)",
    `🗓 Date: ${dateKey} (UTC)`,
    "",
    "🤖 Activity (Created Today)",
    `• AUTO Signals Sent: ${autoSent}`,
    `• /scan Requests: ${scanReq}`,
    `• /scan Signals Sent: ${scanSent}`,
    `• Total Signals Sent: ${totalSent}`,
    "",
    "⏱ Timeframe Breakdown (Signals Sent)",
    tfLine(tfBreakdownSent, tfBreakdownLegacy),
  ];

  if (topScore !== null && avgScore !== null) {
    lines.push("");
    lines.push(`🏆 Top Score: ${topScore}`);
    lines.push(`📈 Avg Score: ${avgScore}`);
  }

  lines.push("");
  lines.push("⏳ Entry Status (Active Signals)");
  lines.push(`• Pending Entry: ${pendingEntry}`);
  lines.push(`• Filled / Open: ${openTrades}`);
  lines.push(`• Expired Today (Not Filled): ${expiredToday}`);

  lines.push("");
  lines.push("🎯 Results (Closed Today)");
  lines.push(`• Closed Trades: ${closedTrades}`);
  lines.push("");
  lines.push(`✅ WIN (≥TP1): ${win}`);
  lines.push(`   - TP1 Hit (max): ${winTp1}`);
  lines.push(`   - TP2 Hit (max): ${winTp2}`);
  lines.push(`   - TP3 Hit (max): ${winTp3}`);
  lines.push("");
  lines.push(`❌ LOSE (SL before TP1): ${lose}`);
  lines.push(`⚠️ Giveback (SL after TP1/TP2): ${giveback}`);
  lines.push("");
  lines.push("📈 Rates (Closed Today)");
  lines.push(`• Winrate (strict): ${winrate}%`);
  lines.push(`• Direct SL Rate: ${slRate}%`);
  lines.push("");
  lines.push("🌐 Macro Summary (UTC)");
  lines.push(`• ${macroSummary}`);
  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("⚠️ Not Financial Advice");

  return lines.join("\n");
}
