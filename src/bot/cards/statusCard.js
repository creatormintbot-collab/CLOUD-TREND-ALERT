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

export function statusCard({
  dateKey,
  timeKey,
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
  openFilled = 0,
  pendingEntry = 0,
  carried = 0,
  intradayCount = 0,
  swingCount = 0
} = {}) {
  const created = Number.isFinite(Number(totalCreated))
    ? Number(totalCreated)
    : num(autoSent) + num(scanSignalsSent);
  const signalsSent = created;
  const winrateText = pctText(winCount, tradingClosed);
  const slRateText = pctText(directSlCount, tradingClosed);

  return [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "🧭 STATUS (UTC)",
    `📅 Today: ${dateKey} | 🕒 Now: ${timeKey}`,
    "",
    "🧠 CREATED (Today)",
    `• Signals Created: ${num(created)} (AUTO ${num(autoSent)} | /scan ${num(scanSignalsSent)})`,
    `• /scan Requests (success): ${num(scanOk)}`,
    `• Signals Sent: ${num(signalsSent)} (AUTO ${num(autoSent)} | /scan ${num(scanSignalsSent)})`,
    "",
    "📈 PROGRESS (Today)",
    `• Entry Hits: ${num(entryHits)}`,
    `• TP1 Hits: ${num(tp1Hits)}`,
    `• TP2 Hits: ${num(tp2Hits)}`,
    `• TP3 Hits: ${num(tp3Hits)}`,
    "",
    "✅ OUTCOMES (Closed Today)",
    `• Trading Closed: ${num(tradingClosed)} (🏆 WIN TP1+: ${num(winCount)} | 🛑 LOSS Direct SL: ${num(directSlCount)})`,
    `• ⏳ Expired (No Entry): ${num(expiredCount)}`,
    `• Rates (Trading Only): Winrate ${winrateText} | Direct SL Rate ${slRateText}`,
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
