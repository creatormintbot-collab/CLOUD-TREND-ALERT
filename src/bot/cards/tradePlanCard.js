import { fmtPrice } from "../../utils/format.js";
import { round } from "../../utils/math.js";

function fmtPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.00%";
  return `${round(n * 100, 2)}%`;
}

function fmtRR(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return n.toFixed(2);
}

function modeLabel() {
  return "Intraday";
}

export function tradePlanCard(plan = {}) {
  const dirRaw = String(plan?.direction || "LONG").toUpperCase();
  const dir = dirRaw === "SHORT" ? "SHORT" : "LONG";
  const dot = dir === "LONG" ? "🟢" : "🔴";

  const sym = plan?.symbol || "N/A";
  const tf = plan?.tf || "15m";
  const biasTf = plan?.biasTf || "1h";

  const levels = plan?.levels || {};
  const entry = levels.entry ?? plan?.entry;
  const sl = levels.sl ?? plan?.sl;
  const tp1 = levels.tp1 ?? plan?.tp1;
  const tp2 = levels.tp2 ?? plan?.tp2;

  const risk = Number.isFinite(Number(plan?.risk))
    ? Number(plan.risk)
    : Math.abs(Number(entry) - Number(sl));

  const reward1 = Math.abs(Number(tp1) - Number(entry));
  const reward2 = Math.abs(Number(tp2) - Number(entry));

  const rr1 = Number.isFinite(Number(plan?.rr?.tp1))
    ? Number(plan.rr.tp1)
    : (risk > 0 ? (reward1 / risk) : null);
  const rr2 = Number.isFinite(Number(plan?.rr?.tp2))
    ? Number(plan.rr.tp2)
    : (risk > 0 ? (reward2 / risk) : null);

  const score = Number.isFinite(Number(plan?.score)) ? Math.round(Number(plan.score)) : null;

  const macro = plan?.macro || {};

  const reasons = Array.isArray(plan?.reasons) ? plan.reasons : [];
  const breakdown = Array.isArray(plan?.scoreBreakdown) ? plan.scoreBreakdown : [];
  const srLevels = Array.isArray(plan?.srLevels) ? plan.srLevels : [];

  const lines = [
    "🤖 CLOUD TREND ALERT",
    "───────────────────",
    `📌 TRADE PLAN — ${dot} ${dir}`,
    `🪙 Pair: ${sym}`,
    `Mode: ${modeLabel()}`,
    `Signal TF: ${tf} | Bias TF: ${biasTf}`,
    score != null ? `Score: ${score} / 100` : null,
    "",
    "Trade Plan",
    `• Entry: ${fmtPrice(entry)}`,
    `• SL: ${fmtPrice(sl)} (risk ${fmtPct(risk / Number(entry || 1))})`,
    `• TP1: ${fmtPrice(tp1)} (reward ${fmtPct(reward1 / Number(entry || 1))}, RR ${fmtRR(rr1)})`,
    `• TP2: ${fmtPrice(tp2)} (reward ${fmtPct(reward2 / Number(entry || 1))}, RR ${fmtRR(rr2)})`,
    "",
    "Macro",
    `• TF: ${macro.tf || "12h"}`,
    `• Bias: ${macro.bias || "N/A"}`,
    `• Score: ${macro.score ?? "N/A"}`,
    `• Note: ${macro.note || "N/A"}`,
    "",
    "Reasons",
    ...(reasons.length ? reasons.map((r) => `• ${r}`) : ["• N/A"]),
    "",
    "Score Breakdown",
    ...(breakdown.length
      ? breakdown.map((b) => `• ${b.label}: ${b.value}`)
      : ["• N/A"]),
    "",
    "SR Levels",
    ...(srLevels.length
      ? srLevels.map((l) => `• ${l.type} @ ${fmtPrice(l.price)} (touches=${l.touches})`)
      : ["• N/A"]),
    "",
    "⚠️ Not Financial Advice"
  ].filter((x) => x !== null);

  return lines.join("\n");
}
