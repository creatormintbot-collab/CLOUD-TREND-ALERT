import { ENV } from "../../config/env.js";

function fmt(n) {
  if (!Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  const dp = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return n.toFixed(dp);
}

export function buildSLCard({ pos, price }) {
  const html = [
    `🛑 <b>${ENV.BOT_NAME}</b>`,
    `<b>Risk Management Alert</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `❌ STOP LOSS HIT`,
    `${pos.symbol} · ${pos.timeframe}`,
    `Price: ${fmt(price)}`,
    ``,
    `🎯 <b>Entry Zone</b>`,
    `${fmt(pos.entryZoneLow)} – ${fmt(pos.entryZoneHigh)}`,
    `🧮 <b>Mid Entry</b>`,
    `${fmt(pos.entryMid)}`,
    ``,
    `📝 <b>Result</b>`,
    `• Trade invalidated`,
    `• Risk managed`,
    ``,
    `Status: <b>CLOSED 🔴</b>`,
    `⚠️ <i>Not Financial Advice</i>`,
  ].join("\n");

  return { html };
}
