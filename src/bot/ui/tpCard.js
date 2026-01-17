import { ENV } from "../../config/env.js";

function fmt(n) {
  if (!Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  const dp = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return n.toFixed(dp);
}

export function buildTPCard({ pos, price, tpLevel, partialPct, actionLines, suggestedSL }) {
  const title = `📈 <b>${ENV.BOT_NAME}</b>\n<b>Position Update</b>`;
  const status = pos.status === "RUNNING" ? "RUNNING 🟡" : "CLOSED 🟢";

  const html = [
    title,
    `━━━━━━━━━━━━━━━━━━`,
    `${tpLevel === 1 ? "✅" : tpLevel === 2 ? "🔥" : "🏆"} TP${tpLevel} HIT (${partialPct}%)`,
    `${pos.symbol} · ${pos.timeframe}`,
    `Price: ${fmt(price)}`,
    ``,
    `🎯 <b>Entry Zone</b>`,
    `${fmt(pos.entryZoneLow)} – ${fmt(pos.entryZoneHigh)}`,
    `🧮 <b>Mid Entry</b>`,
    `${fmt(pos.entryMid)}`,
    ``,
    `📝 <b>Action</b>`,
    ...actionLines.map((x) => `• ${x}`),
    suggestedSL != null ? `🧷 <b>Suggested SL:</b> ${fmt(suggestedSL)}` : ``,
    ``,
    `Status: <b>${status}</b>`,
    `⚠️ <i>Not Financial Advice</i>`,
  ].filter(Boolean).join("\n");

  return { html };
}
