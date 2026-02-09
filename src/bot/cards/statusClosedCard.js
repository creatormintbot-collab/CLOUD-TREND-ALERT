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

export function statusClosedCard({
  dateKey,
  closedCount = 0,
  winCount = 0,
  directSlCount = 0,
  givebackCount = 0,
  list = [],
  moreCount = 0
} = {}) {
  const closed = num(closedCount);
  const winrate = pct(winCount, closed);
  const slRate = pct(directSlCount, closed);

  const lines = [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "🎯 CLOSED TODAY (UTC)",
    `📅 Date: ${dateKey}`,
    "",
    `✅ Closed: ${closed}`,
    `• Win≥TP1: ${num(winCount)} | Direct SL: ${num(directSlCount)} | Giveback: ${num(givebackCount)}`
  ];

  lines.push(`• Rates: Winrate ${winrate} | Direct SL Rate ${slRate}`);

  lines.push("", "🧾 List (Top 15)");

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
