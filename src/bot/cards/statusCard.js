function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export function statusCard({
  dateKey,
  timeKey,
  totalCreated = 0,
  autoSent = 0,
  scanSignalsSent = 0,
  scanOk = 0,
  entryHits = 0,
  closedCount = 0,
  winCount = 0,
  directSlCount = 0,
  givebackCount = 0,
  openFilled = 0,
  pendingEntry = 0,
  carried = 0,
  intradayCount = 0,
  swingCount = 0
} = {}) {
  const created = Number.isFinite(Number(totalCreated))
    ? Number(totalCreated)
    : num(autoSent) + num(scanSignalsSent);

  return [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "🧭 STATUS (UTC)",
    `📅 Today: ${dateKey} | 🕒 Now: ${timeKey}`,
    "",
    "🤖 TODAY (Events)",
    `• Signals Created: ${num(created)} (AUTO ${num(autoSent)} | /scan ${num(scanSignalsSent)})`,
    `• /scan Requests (success): ${num(scanOk)}`,
    `• Entry Hits: ${num(entryHits)}`,
    `• Closed: ${num(closedCount)} (Win≥TP1 ${num(winCount)} (Giveback ${num(givebackCount)}) | Direct SL ${num(directSlCount)})`,
    "",
    "📌 NOW (Snapshot)",
    `• Open (Filled): ${num(openFilled)} | Pending Entry: ${num(pendingEntry)} | Carried: ${num(carried)}`,
    `• By Mode: INTRADAY ${num(intradayCount)} | SWING ${num(swingCount)}`,
    "",
    "🧩 Tip: /statusopen (open list) • /statusclosed (today closed) • /cohort (7d active)",
    "━━━━━━━━━━━━━━━━━━",
    "⚠️ Not Financial Advice"
  ].join("\n");
}
