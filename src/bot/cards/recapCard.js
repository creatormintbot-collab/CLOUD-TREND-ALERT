import { fmtScore } from "../../utils/format.js";

function num(x, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

function compact(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0";
  const abs = Math.abs(x);
  if (abs >= 1e12) return (x / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (x / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (x / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (x / 1e3).toFixed(2) + "K";
  return String(Math.round(x));
}

function tfLine(tfObj, fallbackObj) {
  const o = tfObj || fallbackObj || {};
  const v = (k) => num(o[k], 0);
  return `15m: ${v("15m")} | 30m: ${v("30m")} | 1h: ${v("1h")} | 4h: ${v("4h")}`;
}

function playbookBreakdown(x = {}, tfObj = null) {
  const pbObj =
    (x.playbookBreakdownCreated && typeof x.playbookBreakdownCreated === "object" ? x.playbookBreakdownCreated : null) ||
    (x.modeBreakdownCreated && typeof x.modeBreakdownCreated === "object" ? x.modeBreakdownCreated : null) ||
    null;

  if (pbObj) {
    const intraday = num(pbObj.INTRADAY ?? pbObj.intraday, 0);
    const swing = num(pbObj.SWING ?? pbObj.swing, 0);
    return { intraday, swing };
  }

  // Optional direct fields
  if (x.intradayCreated !== undefined || x.swingCreated !== undefined) {
    return { intraday: num(x.intradayCreated, 0), swing: num(x.swingCreated, 0) };
  }

  const tf = tfObj && typeof tfObj === "object" ? tfObj : null;
  if (tf) {
    const intraday = num(tf["15m"], 0) + num(tf["30m"], 0) + num(tf["1h"], 0);
    const swing = num(tf["4h"], 0);
    return { intraday, swing };
  }

  return { intraday: 0, swing: 0 };
}

function pbLine(intraday, swing, label = "Signals Created") {
  return `[INTRADAY] ${label}: ${intraday} | [SWING] ${label}: ${swing}`;
}

function pct(a, b) {
  const A = Number(a);
  const B = Number(b);
  if (!Number.isFinite(A) || !Number.isFinite(B) || B <= 0) return "0.0";
  return ((A / B) * 100).toFixed(1);
}

/**
 * DAILY RECAP card (UTC)
 * Backwards-compatible:
 * - If newer fields are missing, it will safely default to 0 / N/A.
 */
export function recapCard(x = {}) {
  const dateKey = x.dateKey || x.dateUTC || x.dayKey || "N/A";

  // Activity (Created Today)
  const autoSent = num(x.autoSignalsSent, num(x.autoTotal, 0));

  // Prefer "success" count if available; otherwise fall back to legacy request count.
  const scanReqSuccess = num(
    x.scanRequestsSuccess,
    num(x.scanRequestsOk, num(x.scanRequests, num(x.scanTotal, 0)))
  );

  const scanSent = num(x.scanSignalsSent, num(x.scanSent, 0));
  const totalCreated = num(x.totalSignalsCreated, num(x.totalSignalsSent, (autoSent + scanSent)));

  // Breakdown by timeframe (prefer correct field)
  const tfBreakdownCreated = x.tfBreakdownCreated || x.tfBreakdownSent || x.tfBreakdownSignals || null;
  const tfBreakdownLegacy = x.tfBreakdown || { "15m": 0, "30m": 0, "1h": 0, "4h": 0 };


  const pbCounts = playbookBreakdown(x, tfBreakdownCreated || tfBreakdownLegacy);
  // Signal quality (optional, backwards-compatible)
  const topScore = (x.topScore !== undefined) ? fmtScore(x.topScore) : null;
  const avgScore = (x.avgScore !== undefined) ? Number(num(x.avgScore, 0)).toFixed(2) : null;

  // Entry status (snapshot now)
  const pendingEntry = num(x.pendingEntry, 0);
  const filledOpen = num(x.filledOpen, num(x.openTrades, 0));
  const expiredToday = num(x.expiredToday, 0);
  const entryHitsToday = num(x.entryHitsToday, num(x.entryHitsTodayUtc, 0));
  const carriedOpen = num(x.carriedOpen, num(x.carriedFromPriorDays, 0));

  // Results (Closed Today)
  const closedTrades = num(x.closedTrades, 0);

  const tp1 = num(x.tp1, num(x.winTp1Max, num(x.winTp1, 0)));
  const tp2 = num(x.tp2, num(x.winTp2Max, num(x.winTp2, 0)));
  const tp3 = num(x.tp3, num(x.winTp3Max, num(x.winTp3, 0)));

  const directSl = num(x.directSl, num(x.lose, 0));
  const giveback = num(x.giveback, 0);

  const win = num(x.win, (tp1 + tp2 + tp3));
  const winrateStrict = pct(win, closedTrades);
  const directSlRate = pct(directSl, closedTrades);


  const resultsByPlaybook = (x.resultsByPlaybook && typeof x.resultsByPlaybook === "object") ? x.resultsByPlaybook : null;
  // Cohort (Created Today) — Progress (optional)
  const cohortCreated = num(x.cohortCreated, 0);
  const cohortClosed = num(x.cohortClosedSoFar, num(x.cohortClosed, 0));
  const cohortStillOpen = num(x.cohortStillOpen, Math.max(0, cohortCreated - cohortClosed));

  const cTp1 = num(x.cohortTp1, 0);
  const cTp2 = num(x.cohortTp2, 0);
  const cTp3 = num(x.cohortTp3, 0);

  const cohortWins = num(x.cohortWins, (cTp1 + cTp2 + cTp3));
  const cohortDirectSl = num(x.cohortDirectSl, 0);
  const cohortGiveback = num(x.cohortGiveback, 0);
  const cohortWinrate = (cohortClosed > 0) ? pct(cohortWins, cohortClosed) : "0.0";

  // Macro (optional)
  const macroCounts = x.macroCounts && typeof x.macroCounts === "object" ? x.macroCounts : null;
  const macroSummary = x.macroSummary || "BTC: N/A | ALTS: N/A | Bias: N/A";

  const lines = [
    "🤖 CLOUD TREND ALERT",
    "───────────────────",
    "🗓 DAILY FUTURES RECAP (UTC)",
    `Date: ${dateKey} (UTC)`,
    "",
    "🤖 Activity (Created Today)",
    `• AUTO Signals Sent: ${autoSent}`,
    `• /scan Requests (success): ${scanReqSuccess}`,
    `• /scan Signals Sent: ${scanSent}`,
    `• Total Signals Created: ${totalCreated}`,
    "",
    "⏱ Timeframe Breakdown (Signals Created)",
    tfLine(tfBreakdownCreated, tfBreakdownLegacy),
    "",
    "🧭 Mode Breakdown (Signals Created)",
    pbLine(pbCounts.intraday, pbCounts.swing),
  ];

  if (topScore !== null && avgScore !== null) {
    lines.push("");
    lines.push("🏆 Signal Quality (Created Today)");
    lines.push(`• Top Score: ${topScore}`);
    lines.push(`• Avg Score: ${avgScore}`);
  }

  lines.push("");
  lines.push("⏳ Entry Status (Snapshot Now)");
  lines.push(`• Pending Entry: ${pendingEntry}`);
  lines.push(`• Filled / Open: ${filledOpen}`);
  lines.push(`• Expired Today (Not Filled): ${expiredToday}`);
  lines.push(`• Entry Hits Today (UTC): ${entryHitsToday}`);
  lines.push(`• Carried Open From Prior Days: ${carriedOpen}`);

  lines.push("");
  lines.push("🎯 Results (Closed Today)");
  lines.push(`• Closed Trades Today: ${closedTrades}`);
  lines.push("");
  lines.push(`✅ WIN (≥TP1): ${win}`);
  lines.push(`   - TP1 (max): ${tp1}`);
  lines.push(`   - TP2 (max): ${tp2}`);
  lines.push(`   - TP3 (max): ${tp3}`);
  lines.push("");
  lines.push(`❌ LOSE (SL before TP1): ${directSl}`);
  lines.push(`⚠️ Giveback (SL after TP1/TP2): ${giveback}`);
  lines.push("");
  lines.push("📈 Rates (Closed Today)");
  lines.push(`• Winrate (strict): ${winrateStrict}%`);
  lines.push(`• Direct SL Rate: ${directSlRate}%`);

if (resultsByPlaybook) {
  const i = resultsByPlaybook.INTRADAY || resultsByPlaybook.intraday || {};
  const w = resultsByPlaybook.SWING || resultsByPlaybook.swing || {};
  lines.push("");
  lines.push("🧭 Results by Mode (Closed Today)");
  lines.push(`[INTRADAY] Closed: ${num(i.closed, 0)} | WIN(≥TP1): ${num(i.win, 0)} | Direct SL: ${num(i.directSl, 0)}`);
  lines.push(`[SWING] Closed: ${num(w.closed, 0)} | WIN(≥TP1): ${num(w.win, 0)} | Direct SL: ${num(w.directSl, 0)}`);
}


  lines.push("");
  lines.push("🧪 Cohort (Created Today) — Progress");
  lines.push(`• Signals Created Today: ${cohortCreated}`);
  lines.push(`• Closed So Far: ${cohortClosed}`);
  lines.push(`• Still Open: ${cohortStillOpen}`);
  lines.push("");
  lines.push(`✅ Cohort Wins (≥TP1): ${cohortWins}`);
  lines.push(`   - TP1 (max): ${cTp1}`);
  lines.push(`   - TP2 (max): ${cTp2}`);
  lines.push(`   - TP3 (max): ${cTp3}`);
  lines.push("");
  lines.push(`❌ Cohort Direct SL: ${cohortDirectSl}`);
  lines.push(`⚠️ Cohort Giveback: ${cohortGiveback}`);
  lines.push(`• Cohort Winrate (closed so far): ${cohortWinrate}%`);

  lines.push("");
  lines.push("🌐 Macro Summary (UTC)");
  if (macroCounts) {
    lines.push(`• BULLISH: ${num(macroCounts.bullish, 0)} | BEARISH: ${num(macroCounts.bearish, 0)} | NEUTRAL: ${num(macroCounts.neutral, 0)}`);
  } else {
    lines.push(`• ${macroSummary}`);
  }

  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("⚠️ Not Financial Advice");

  return lines.join("\n");
}