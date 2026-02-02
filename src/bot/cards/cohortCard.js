function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export function cohortActiveCard({ timeKey, rows = [] } = {}) {
  const lines = [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "🧪 COHORT ACTIVE (UTC)",
    `📆 Window: last 7 days | 🕒 Now: ${timeKey}`,
    "",
    "📊 Open/Pending by Created Date"
  ];

  if (rows.length) {
    for (const row of rows) {
      lines.push(`• ${row.dateKey}: Pending ${num(row.pending)} | Open ${num(row.open)}`);
    }
  }

  lines.push("");
  lines.push("🧩 Tip: /cohort YYYY-MM-DD for details (Top 15 list).");
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
    `• Closed: ${num(closedCount)} (Win≥TP1 ${num(winCount)} (Giveback ${num(givebackCount)}) | Direct SL ${num(directSlCount)})`,
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
