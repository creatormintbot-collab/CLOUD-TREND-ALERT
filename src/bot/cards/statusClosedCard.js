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
  winCount = 0,
  directSlCount = 0,
  expiredCount = 0,
  list = [],
  moreCount = 0
} = {}) {
  const tradingClosed = num(winCount) + num(directSlCount);
  const winrate = pct(winCount, tradingClosed);
  const slRate = pct(directSlCount, tradingClosed);

  const lines = [
    "🤖 CLOUD TREND ALERT",
    "───────────────────",
    "🧾 STATUS CLOSED (UTC)",
    `Day: ${dateKey} (UTC)`,
    "Scope: This chat only (UTC)",
    "",
    "✅ OUTCOMES",
    `• Trading Closed: ${tradingClosed} (W ${num(winCount)} | L ${num(directSlCount)})`,
    `• Expired: ${num(expiredCount)}`
  ];

  lines.push(`• Rates: Winrate ${winrate} | Direct SL Rate ${slRate}`);

  lines.push("", "🧾 CLOSED LIST");

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
