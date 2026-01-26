function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export function statusOpenCard({
  timeKey,
  showing = 0,
  openFilled = 0,
  pendingEntry = 0,
  carried = 0,
  list = [],
  moreCount = 0
} = {}) {
  const lines = [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "📍 OPEN POSITIONS (UTC)",
    `🕒 Now: ${timeKey} | Showing: ${num(showing)}`,
    "",
    "🧾 Summary",
    `• Open (Filled): ${num(openFilled)} | Pending Entry: ${num(pendingEntry)} | Carried: ${num(carried)}`,
    "",
    "📋 List"
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
