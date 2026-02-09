function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export function statusOpenCard({
  timeKey,
  openFilled = 0,
  pendingEntry = 0,
  carried = 0,
  list = [],
  moreCount = 0
} = {}) {
  const lines = [
    "🤖 CLOUD TREND ALERT",
    "───────────────────",
    "📌 STATUS OPEN (UTC)",
    `Now: ${timeKey} (UTC)`,
    "Scope: This chat only (UTC)",
    "",
    "📌 NOW",
    `• Open (Filled): ${num(openFilled)}`,
    `• Pending Entry: ${num(pendingEntry)}`,
    `• Carried: ${num(carried)}`,
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
