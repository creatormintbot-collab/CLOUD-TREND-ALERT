const HEADER = ["CLOUD TREND ALERT", "------------------"];

function pct(a, b) {
  const A = Number(a);
  const B = Number(b);
  if (!Number.isFinite(A) || !Number.isFinite(B) || B <= 0) return "0.0";
  return ((A / B) * 100).toFixed(1);
}

function buildNumberedList(rows = [], limit = 15, emptyLabel = "None") {
  if (!rows.length) return [emptyLabel];
  const out = rows.slice(0, limit).map((row, idx) => `${idx + 1}) ${row}`);
  const more = rows.length - limit;
  if (more > 0) out.push(`(+${more} more)`);
  return out;
}

export function statusCard({
  dateKey,
  timeKey,
  autoSent = 0,
  scanOk = 0,
  scanSignalsSent = 0,
  totalCreated = 0,
  entryHitsToday = 0,
  closedToday = 0,
  tp1Today = 0,
  tp2Today = 0,
  tp3Today = 0,
  directSlToday = 0,
  runningTotal = 0,
  entryHitRunning = 0,
  pendingEntry = 0,
  carriedRunning = 0
}) {
  return [
    ...HEADER,
    "STATUS (UTC)",
    `Date: ${dateKey} | Now: ${timeKey} (UTC)`,
    "",
    "Today (UTC)",
    `- Signals Created: ${totalCreated} (AUTO ${autoSent} | /scan ${scanSignalsSent})`,
    `- /scan Requests (success): ${scanOk}`,
    `- Entry Hits: ${entryHitsToday}`,
    `- Closed Today: ${closedToday} (TP3 ${tp3Today} / TP2 ${tp2Today} / TP1 ${tp1Today} / SL ${directSlToday})`,
    "",
    "Snapshot Now",
    `- Active Total: ${runningTotal}`,
    `- Open (Entry Hit): ${entryHitRunning}`,
    `- Pending Entry: ${pendingEntry}`,
    `- Carried From Prior Days: ${carriedRunning}`,
    "",
    "Not Financial Advice"
  ].join("\n");
}

export function statusOpenCard({
  dateKey,
  timeKey,
  runningTotal = 0,
  entryHitRunning = 0,
  pendingEntry = 0,
  carriedRunning = 0,
  rows = []
}) {
  const listLines = buildNumberedList(rows, 15, "No active positions.");
  return [
    ...HEADER,
    "OPEN & PENDING (UTC)",
    `Date: ${dateKey} | Now: ${timeKey} (UTC)`,
    "",
    "Summary",
    `- Active Total: ${runningTotal}`,
    `- Open (Entry Hit): ${entryHitRunning}`,
    `- Pending Entry: ${pendingEntry}`,
    `- Carried From Prior Days: ${carriedRunning}`,
    "",
    "Top 15 (Newest)",
    ...listLines,
    "",
    "Not Financial Advice"
  ].join("\n");
}

export function statusClosedCard({
  dateKey,
  timeKey,
  closedToday = 0,
  tp1Today = 0,
  tp2Today = 0,
  tp3Today = 0,
  directSlToday = 0,
  givebackToday = 0,
  rows = []
}) {
  const winToday = tp1Today + tp2Today + tp3Today;
  const winrate = pct(winToday, closedToday);
  const directSlRate = pct(directSlToday, closedToday);
  const listLines = buildNumberedList(rows, 15, "No closed positions today.");

  const lines = [
    ...HEADER,
    "CLOSED TODAY (UTC)",
    `Date: ${dateKey} | Now: ${timeKey} (UTC)`,
    "",
    "Summary",
    `- Closed Trades: ${closedToday}`,
    `- TP3 ${tp3Today} | TP2 ${tp2Today} | TP1 ${tp1Today} | SL ${directSlToday}`,
    `- Giveback: ${givebackToday}`
  ];

  if (closedToday > 0) {
    lines.push(`- Rates: Winrate (>=TP1) ${winrate}% | Direct SL ${directSlRate}%`);
  }

  lines.push("", "Top 15 (Latest)", ...listLines, "", "Not Financial Advice");
  return lines.join("\n");
}

export function cohortSummaryCard({
  startKey,
  endKey,
  rows = [],
  totalOpen = 0,
  totalPending = 0
}) {
  const listLines = rows.length
    ? rows.map((row) => `${row.dateKey}: Open ${row.open} | Pending ${row.pending}`)
    : ["No active cohorts in the last 7 days."];

  return [
    ...HEADER,
    "COHORT - ACTIVE WINDOW (UTC)",
    `Range: ${startKey} -> ${endKey} (last 7 days)`,
    "",
    "Open / Pending by Created Date",
    ...listLines,
    "",
    `Total Open: ${totalOpen} | Total Pending: ${totalPending}`,
    "",
    "Not Financial Advice"
  ].join("\n");
}

export function cohortDetailCard({
  dateKey,
  totalCreated = 0,
  openCount = 0,
  pendingCount = 0,
  closedCount = 0,
  tp1 = 0,
  tp2 = 0,
  tp3 = 0,
  directSl = 0,
  giveback = 0,
  listLabel = "Open",
  rows = []
}) {
  const win = tp1 + tp2 + tp3;
  const winrate = pct(win, closedCount);
  const directSlRate = pct(directSl, closedCount);
  const listLines = buildNumberedList(rows, 15, "No positions for this cohort.");

  const lines = [
    ...HEADER,
    "COHORT DETAIL (UTC)",
    `Created: ${dateKey}`,
    "",
    "Progress Now",
    `- Created: ${totalCreated}`,
    `- Open (Entry Hit): ${openCount}`,
    `- Pending: ${pendingCount}`,
    `- Closed: ${closedCount}`,
    "",
    "Results Since Created",
    `- TP3 ${tp3} | TP2 ${tp2} | TP1 ${tp1} | SL ${directSl}`,
    `- Giveback: ${giveback}`
  ];

  if (closedCount > 0) {
    lines.push(`- Rates: Winrate (>=TP1) ${winrate}% | Direct SL ${directSlRate}%`);
  }

  lines.push("", `Positions (${listLabel}, Top 15)`, ...listLines, "", "Not Financial Advice");
  return lines.join("\n");
}

export function infoCard({
  dateKey,
  autoSent = 0,
  scanOk = 0,
  scanSignalsSent = 0,
  totalCreated = 0,
  entryHits = 0,
  expired = 0,
  closedTrades = 0,
  tp1 = 0,
  tp2 = 0,
  tp3 = 0,
  directSl = 0,
  giveback = 0
}) {
  const win = tp1 + tp2 + tp3;
  const winrate = pct(win, closedTrades);
  const directSlRate = pct(directSl, closedTrades);

  const lines = [
    ...HEADER,
    "DAILY RECAP (UTC)",
    `Date: ${dateKey}`,
    "",
    "Activity (Created on Date)",
    `- Signals Created: ${totalCreated} (AUTO ${autoSent} | /scan ${scanSignalsSent})`,
    `- /scan Requests (success): ${scanOk}`,
    "",
    "Events (UTC)",
    `- Entry Hits: ${entryHits}`,
    `- Closed Trades: ${closedTrades}`,
    `- Expired (Not Filled): ${expired}`,
    "",
    "Results (Closed on Date)",
    `- TP3 ${tp3} | TP2 ${tp2} | TP1 ${tp1} | SL ${directSl}`,
    `- Giveback: ${giveback}`
  ];

  if (closedTrades > 0) {
    lines.push(`- Rates: Winrate (>=TP1) ${winrate}% | Direct SL ${directSlRate}%`);
  }

  lines.push("", "Not Financial Advice");
  return lines.join("\n");
}
