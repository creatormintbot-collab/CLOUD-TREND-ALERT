function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function pct(a, b) {
  const A = Number(a);
  const B = Number(b);
  if (!Number.isFinite(A) || !Number.isFinite(B) || B <= 0) return "0.0";
  return ((A / B) * 100).toFixed(1);
}

export function infoCard({
  dateKey,
  totalCreated = 0,
  autoSent = 0,
  scanSignalsSent = 0,
  scanOk = 0,
  entryHits = 0,
  closedCount = 0,
  winCount = 0,
  directSlCount = 0,
  givebackCount = 0,
  bullCount = 0,
  bearCount = 0,
  neutralCount = 0
} = {}) {
  const created = Number.isFinite(Number(totalCreated))
    ? Number(totalCreated)
    : num(autoSent) + num(scanSignalsSent);
  const closed = num(closedCount);
  const winrate = pct(winCount, closed);
  const slRate = pct(directSlCount, closed);

  const lines = [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "🗓 DAILY RECAP (UTC)",
    `📅 Date: ${dateKey}`,
    "",
    "🧠 Activity (Created That Day)",
    `• Signals Created: ${num(created)} (AUTO ${num(autoSent)} | /scan ${num(scanSignalsSent)})`,
    `• /scan Requests (success): ${num(scanOk)}`,
    `• Signals Sent: AUTO ${num(autoSent)} | /scan ${num(scanSignalsSent)}`,
    "",
    "📌 Events (That Day)",
    `• Entry Hits: ${num(entryHits)}`,
    `• Closed: ${closed} (Win≥TP1 ${num(winCount)} (Giveback ${num(givebackCount)}) | Direct SL ${num(directSlCount)})`
  ];

  if (closed > 0) {
    lines.push(`• Rates: Winrate ${winrate}% | Direct SL Rate ${slRate}%`);
  }

  lines.push("");
  lines.push("🌐 Macro (UTC)");
  lines.push(`• BULL: ${num(bullCount)} | BEAR: ${num(bearCount)} | NEUTRAL: ${num(neutralCount)}`);
  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("⚠️ Not Financial Advice");
  return lines.join("\n");
}
