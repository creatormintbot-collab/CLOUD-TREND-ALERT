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

export function cohortRangeCard({
  days = 10,
  startKey,
  endKey,
  timeKey,
  rows = [],
  totals = {}
} = {}) {
  const created = num(totals.created);
  const entry = num(totals.entry);
  const win = num(totals.win);
  const loss = num(totals.loss);
  const expired = num(totals.expired);
  const tradingClosed = win + loss;
  const winrate = pct(win, tradingClosed);
  const slRate = pct(loss, tradingClosed);

  const lines = [
    "🤖 CLOUD TREND ALERT",
    "───────────────────",
    `🧪 COHORT (UTC) — LAST ${num(days)}d (CREATED DATE)`,
    `Window: ${startKey} to ${endKey} | Now: ${timeKey} (UTC)`,
    "Scope: This chat only (UTC)",
    "",
    "🗓️ DAILY SUMMARY"
  ];

  if (rows.length) {
    for (const row of rows) lines.push(row);
  } else {
    lines.push("• None");
  }

  lines.push(
    "",
    "📦 TOTAL",
    `• Created: ${created}`,
    `• Entry: ${entry}`,
    `• Trading Closed: ${tradingClosed} (W ${win} | L ${loss})`,
    `• Expired: ${expired}`,
    `• Rates: Winrate ${winrate} | Direct SL Rate ${slRate}`,
    "",
    "Tip: /cohort YYYY-MM-DD for details",
    "",
    "───────────────────",
    "⚠️ Not Financial Advice"
  );

  return lines.join("\n");
}
