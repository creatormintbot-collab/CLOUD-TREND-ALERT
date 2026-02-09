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
  winCount = 0,
  directSlCount = 0,
  expiredCount = 0,
  list = [],
  moreCount = 0
} = {}) {
  const tradingClosed = num(winCount) + num(directSlCount);
  const winrate = tradingClosed > 0 ? ((num(winCount) / tradingClosed) * 100).toFixed(1) + "%" : "N/A";
  const directSlRate = tradingClosed > 0 ? ((num(directSlCount) / tradingClosed) * 100).toFixed(1) + "%" : "N/A";

  const lines = [
    "🤖 CLOUD TREND ALERT",
    "───────────────────",
    "🧪 COHORT (UTC) — ACTIVE 7D",
    `Window: last 7d | Now: ${timeKey} (UTC)`,
    "Scope: This chat only (UTC)",
    "",
    "🧠 CREATED",
    `• Signals: ${num(totalCreated)} (AUTO ${num(autoSent)} | /scan ${num(scanSignalsSent)})`,
    "",
    "📈 PROGRESS",
    `• Entry Hits: ${num(entryHits)}`,
    `• TP1: ${num(tp1Hits)} | TP2: ${num(tp2Hits)} | TP3: ${num(tp3Hits)}`,
    "",
    "✅ OUTCOMES",
    `• Trading Closed: ${num(tradingClosed)} (W ${num(winCount)} | L ${num(directSlCount)})`,
    `• Expired: ${num(expiredCount)}`,
    `• Rates: Winrate ${winrate} | Direct SL Rate ${directSlRate}`,
    "",
    "📄 OPEN LIST"
  ];

  if (list.length) {
    for (const row of list) lines.push(`• ${row}`);
  } else {
    lines.push("• None");
  }

  if (moreCount > 0) {
    lines.push(`• ... (+${moreCount} more)`);
  }

  lines.push("", "───────────────────", "⚠️ Not Financial Advice");
  return lines.join("\n");
}

export function cohortDetailCard({
  dateKey,
  timeKey,
  createdCount = 0,
  totalCreated = 0,
  autoSent = 0,
  scanSignalsSent = 0,
  winCount = 0,
  directSlCount = 0,
  expiredCount = 0,
  activeCount = 0,
  closedCount = 0,
  activeList = [],
  closedList = [],
  moreActiveCount = 0,
  moreClosedCount = 0
} = {}) {
  const tradingClosed = num(winCount) + num(directSlCount);
  const winrate = tradingClosed > 0 ? ((num(winCount) / tradingClosed) * 100).toFixed(1) + "%" : "N/A";
  const directSlRate = tradingClosed > 0 ? ((num(directSlCount) / tradingClosed) * 100).toFixed(1) + "%" : "N/A";

  const lines = [
    "🤖 CLOUD TREND ALERT",
    "───────────────────",
    `🧪 COHORT (UTC) — CREATED ${dateKey}`,
    `Created: ${dateKey} | Now: ${timeKey} (UTC)`,
    "Scope: This chat only (UTC)",
    "",
    "🧠 CREATED",
    `• Positions: ${num(createdCount)}`,
    `• Signals: ${num(totalCreated)} (AUTO ${num(autoSent)} | /scan ${num(scanSignalsSent)})`,
    "",
    "✅ OUTCOMES",
    `• Trading Closed: ${num(tradingClosed)} (W ${num(winCount)} | L ${num(directSlCount)})`,
    `• Expired: ${num(expiredCount)}`,
    `• Rates: Winrate ${winrate} | Direct SL Rate ${directSlRate}`,
    "",
    "🧮 COHORT CHECK",
    `• Created: ${num(createdCount)} | Active: ${num(activeCount)} | Closed: ${num(closedCount)} | Expired: ${num(expiredCount)}`,
    "",
    "📄 OPEN LIST"
  ];

  if (activeList.length) {
    for (const row of activeList) lines.push(`• ${row}`);
  } else {
    lines.push("• None");
  }

  if (moreActiveCount > 0) {
    lines.push(`• ... (+${moreActiveCount} more)`);
  }

  lines.push("", "🧾 CLOSED LIST");

  if (closedList.length) {
    for (const row of closedList) lines.push(`• ${row}`);
  } else {
    lines.push("• None");
  }

  if (moreClosedCount > 0) {
    lines.push(`• ... (+${moreClosedCount} more)`);
  }

  lines.push("", "───────────────────", "⚠️ Not Financial Advice");
  return lines.join("\n");
}
