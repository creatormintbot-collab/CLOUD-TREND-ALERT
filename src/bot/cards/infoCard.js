function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function pctText(a, b) {
  const A = Number(a);
  const B = Number(b);
  if (!Number.isFinite(A) || !Number.isFinite(B) || B <= 0) return "N/A";
  return ((A / B) * 100).toFixed(1) + "%";
}

export function infoCard({
  dateKey,
  totalCreated = 0,
  autoSent = 0,
  scanSignalsSent = 0,
  scanOk = 0,
  entryHits = 0,
  tp1Hits = 0,
  tp2Hits = 0,
  tp3Hits = 0,
  tradingClosed = 0,
  winCount = 0,
  directSlCount = 0,
  expiredCount = 0,
  bullCount = 0,
  bearCount = 0,
  neutralCount = 0
} = {}) {
  const created = Number.isFinite(Number(totalCreated))
    ? Number(totalCreated)
    : num(autoSent) + num(scanSignalsSent);
  const signalsSent = created;
  const winrateText = pctText(winCount, tradingClosed);
  const slRateText = pctText(directSlCount, tradingClosed);

  const lines = [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "🗓 DAILY RECAP (UTC)",
    `📅 Date: ${dateKey}`,
    "",
    "🧠 CREATED (That Day)",
    `• Signals Created: ${num(created)} (AUTO ${num(autoSent)} | /scan ${num(scanSignalsSent)})`,
    `• /scan Requests (success): ${num(scanOk)}`,
    `• Signals Sent: ${num(signalsSent)} (AUTO ${num(autoSent)} | /scan ${num(scanSignalsSent)})`,
    "",
    "📈 PROGRESS (That Day)",
    `• Entry Hits: ${num(entryHits)}`,
    `• TP1 Hits: ${num(tp1Hits)}`,
    `• TP2 Hits: ${num(tp2Hits)}`,
    `• TP3 Hits: ${num(tp3Hits)}`,
    "",
    "✅ OUTCOMES (Closed That Day)",
    `• Trading Closed: ${num(tradingClosed)} (🏆 WIN TP1+: ${num(winCount)} | 🛑 LOSS Direct SL: ${num(directSlCount)})`,
    `• ⏳ Expired (No Entry): ${num(expiredCount)}`,
    `• Rates (Trading Only): Winrate ${winrateText} | Direct SL Rate ${slRateText}`
  ];

  lines.push("");
  lines.push("🌐 Macro (UTC)");
  lines.push(`• BULL: ${num(bullCount)} | BEAR: ${num(bearCount)} | NEUTRAL: ${num(neutralCount)}`);
  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("⚠️ Not Financial Advice");
  return lines.join("\n");
}
