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

export function cohortActiveCard({
  timeKey,
  totalCreated = 0,
  autoSent = 0,
  scanSignalsSent = 0,
  entryHits = 0,
  tp1Hits = 0,
  tp2Hits = 0,
  tp3Hits = 0,
  tradingClosed = 0,
  winCount = 0,
  directSlCount = 0,
  expiredCount = 0,
  list = [],
  moreCount = 0
} = {}) {
  const created = Number.isFinite(Number(totalCreated))
    ? Number(totalCreated)
    : num(autoSent) + num(scanSignalsSent);
  const winrateText = pctText(winCount, tradingClosed);
  const slRateText = pctText(directSlCount, tradingClosed);
  const lines = [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "🧪 COHORT (UTC) — ACTIVE 7D",
    `📆 Window: last 7d | 🕒 Now: ${timeKey}`,
    "",
    "🧠 Created (7D)",
    `• Signals Created: ${num(created)} (AUTO ${num(autoSent)} | /scan ${num(scanSignalsSent)})`,
    "",
    "📈 Progress (7D)",
    `• Entry Hits: ${num(entryHits)}`,
    `• TP1 Hits: ${num(tp1Hits)}`,
    `• TP2 Hits: ${num(tp2Hits)}`,
    `• TP3 Hits: ${num(tp3Hits)}`,
    "",
    "✅ Outcomes (7D)",
    `• Trading Closed: ${num(tradingClosed)} (🏆 WIN TP1+: ${num(winCount)} | 🛑 LOSS Direct SL: ${num(directSlCount)})`,
    `• ⏳ Expired (No Entry): ${num(expiredCount)}`,
    `• Rates (Trading Only): Winrate ${winrateText} | Direct SL Rate ${slRateText}`,
    "",
    "📋 Open List (Top 15)"
  ];

  if (list.length) {
    for (const row of list) lines.push(`• ${row}`);
  }

  if (moreCount > 0) {
    lines.push(`... (+${moreCount} more)`);
  }

  lines.push("");
  lines.push("🧩 Tip: /cohort YYYY-MM-DD for created-date analytics (Top 15 list).");
  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("⚠️ Not Financial Advice");
  return lines.join("\n");
}

export function cohortDetailCard({
  dateKey,
  ageDays = 0,
  timeKey,
  totalCreated = 0,
  autoSent = 0,
  scanSignalsSent = 0,
  pendingEntry = 0,
  openFilled = 0,
  closedCount = 0,
  expiredCount = 0,
  entryHits = 0,
  tp1Hits = 0,
  tp2Hits = 0,
  tp3Hits = 0,
  tradingClosed = 0,
  winCount = 0,
  directSlCount = 0,
  list = [],
  moreCount = 0
} = {}) {
  const winrateText = pctText(winCount, tradingClosed);
  const slRateText = pctText(directSlCount, tradingClosed);
  const lines = [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "🧪 COHORT (UTC)",
    `📅 Created Date: ${dateKey} | ⏳ Age: D+${num(ageDays)} | 🕒 Now: ${timeKey}`,
    "",
    `🧬 Created: ${num(totalCreated)} (AUTO ${num(autoSent)} | /scan ${num(scanSignalsSent)})`,
    "",
    "📈 Progress (Now)",
    `• Pending Entry: ${num(pendingEntry)} | Open (Filled): ${num(openFilled)} | Closed: ${num(closedCount)} | Expired: ${num(expiredCount)}`,
    "",
    "📈 Progress (Since Created)",
    `• Entry Hits: ${num(entryHits)}`,
    `• TP1 Hits: ${num(tp1Hits)}`,
    `• TP2 Hits: ${num(tp2Hits)}`,
    `• TP3 Hits: ${num(tp3Hits)}`,
    "",
    "✅ Outcomes (Since Created)",
    `• Trading Closed: ${num(tradingClosed)} (🏆 WIN TP1+: ${num(winCount)} | 🛑 LOSS Direct SL: ${num(directSlCount)})`,
    `• ⏳ Expired (No Entry): ${num(expiredCount)}`,
    `• Rates (Trading Only): Winrate ${winrateText} | Direct SL Rate ${slRateText}`,
    "",
    "📋 Open List (Top 15)"
  ];

  if (list.length) {
    for (const row of list) lines.push(`• ${row}`);
  }

  if (moreCount > 0) {
    lines.push(`... (+${moreCount} more)`);
  }

  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("⚠️ Not Financial Advice");
  return lines.join("\n");
}
