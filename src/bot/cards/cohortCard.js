function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
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
  winrate = "N/A",
  directSlRate = "N/A",
  list = [],
  moreCount = 0
} = {}) {
  const lines = [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "🧪 COHORT (UTC) — ACTIVE 7D",
    `📆 Window: last 7d | 🕒 Now: ${timeKey}`,
    "",
    `🧠 Created (7D): ${num(totalCreated)} (AUTO ${num(autoSent)} | /scan ${num(scanSignalsSent)})`,
    "",
    "📈 Progress (7D)",
    `• Entry Hits: ${num(entryHits)} | TP1: ${num(tp1Hits)} | TP2: ${num(tp2Hits)} | TP3: ${num(tp3Hits)}`,
    "",
    "✅ Outcomes (Trading Only)",
    `• Trading Closed: ${num(tradingClosed)} (🏆 WIN TP1+: ${num(winCount)} | 🛑 LOSS Direct SL: ${num(directSlCount)})`,
    `• ⏳ Expired (No Entry): ${num(expiredCount)}`,
    `• 📊 Rates (Trading Only): Winrate ${winrate} | Direct SL Rate ${directSlRate}`,
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
  winCount = 0,
  directSlCount = 0,
  givebackCount = 0,
  list = [],
  moreCount = 0
} = {}) {
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
    "🧾 Since Created (D0→Now)",
    `• Entry Hits: ${num(entryHits)}`,
    `• Closed: ${num(closedCount)} (Win≥TP1 ${num(winCount)} | Direct SL ${num(directSlCount)} | Giveback ${num(givebackCount)})`,
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
