function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function pct(a, b) {
  const A = Number(a);
  const B = Number(b);
  if (!Number.isFinite(A) || !Number.isFinite(B) || B <= 0) return "N/A";
  return ((A / B) * 100).toFixed(1) + "%";
}

export function infoCard({
  dateKey,
  generatedKey,
  generatedTime,
  totalCreated = 0,
  autoSent = 0,
  scanSignalsSent = 0,
  scanOk = 0,
  entryHits = 0,
  winCount = 0,
  directSlCount = 0,
  expiredCount = 0
} = {}) {
  const created = Number.isFinite(Number(totalCreated))
    ? Number(totalCreated)
    : num(autoSent) + num(scanSignalsSent);
  const tradingClosed = num(winCount) + num(directSlCount);
  const winrate = pct(winCount, tradingClosed);
  const slRate = pct(directSlCount, tradingClosed);

  const lines = [
    "🤖 CLOUD TREND ALERT",
    "───────────────────",
    "📅 DAILY RECAP (UTC)",
    `Day: ${dateKey} | Generated: ${generatedKey} ${generatedTime} (UTC)`,
    "Scope: This chat only (UTC)",
    "",
    "🧠 CREATED",
    `• Signals: ${num(created)} (AUTO ${num(autoSent)} | /scan ${num(scanSignalsSent)})`,
    `• /scan OK: ${num(scanOk)}`,
    "",
    "📈 PROGRESS",
    `• Entry Hits: ${num(entryHits)}`,
    "",
    "✅ OUTCOMES",
    `• Trading Closed: ${tradingClosed} (W ${num(winCount)} | L ${num(directSlCount)})`,
    `• Expired: ${num(expiredCount)}`
  ];

  lines.push(`• Rates: Winrate ${winrate} | Direct SL Rate ${slRate}`);
  lines.push("", "───────────────────", "⚠️ Not Financial Advice");
  return lines.join("\n");
}
