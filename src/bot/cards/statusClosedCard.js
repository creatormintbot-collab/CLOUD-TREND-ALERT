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

export function statusClosedCard({
  dateKey,
  tradingClosed = 0,
  winCount = 0,
  directSlCount = 0,
  expiredCount = 0,
  list = [],
  moreCount = 0
} = {}) {
  const closed = num(tradingClosed);
  const winrateText = pctText(winCount, closed);
  const slRateText = pctText(directSlCount, closed);

  const lines = [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "🎯 CLOSED TODAY (UTC)",
    `📅 Date: ${dateKey}`,
    "",
    `✅ Trading Closed: ${closed} (🏆 WIN: ${num(winCount)} | 🛑 LOSS: ${num(directSlCount)})`,
    `⏳ Expired (No Entry): ${num(expiredCount)}`,
    `📊 Rates (Trading Only): Winrate ${winrateText} | Direct SL Rate ${slRateText}`
  ];

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
