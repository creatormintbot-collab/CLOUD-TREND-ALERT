import { fmtPrice } from "../../utils/format.js";


function resolvePlaybook(obj = {}) {
  const pb = String(obj?.playbook || "").toUpperCase();
  if (pb === "INTRADAY" || pb === "SWING") return pb;
  const tf = String(obj?.tf || obj?.timeframe || "").toLowerCase();
  if (tf === "4h") return "SWING";
  return "INTRADAY";
}

function modeLabel(playbook) {
  return playbook === "SWING" ? "Swing" : "Intraday";
}

function confluenceActive(obj = {}) {
  if (obj?.confluence === true || obj?.isConfluence === true) return true;
  const tfs = obj?.confluenceTfs || obj?.confluenceTFs || obj?.confluenceTimeframes;
  if (Array.isArray(tfs) && tfs.length >= 2) return true;
  const tag = obj?.tag || obj?.tags || obj?.label;
  if (typeof tag === "string" && tag.toLowerCase().includes("confluence")) return true;
  return false;
}


export function tp1Card(pos) {
  const pb = resolvePlaybook(pos);
  const conf = confluenceActive(pos);
  return [
    "🤖 CLOUD TREND ALERT",
    "───────────────────",
    "✅ TP1 HIT — 25%",
    `🪙 Pair: ${pos.symbol}`,
    `Mode: ${modeLabel(pb)}`,
    `Signal TF: ${pos.tf}`,
    conf ? `Confluence: Intraday + Swing` : null,
    "",
    "🎯 Entry Zone:",
    `${fmtPrice(pos.levels.entryLow)} – ${fmtPrice(pos.levels.entryHigh)}`,
    "⚖️ Mid Entry:",
    `${fmtPrice(pos.levels.entryMid)}`,
    "",
    "✅ TP1 Reached:",
    `${fmtPrice(pos.levels.tp1)}`,
    "",
    "🧷 Action:",
    "• Secure partial profit (25%)",
    "• Move SL to BE±0.10R",
    "",
    "🛡 Suggested SL (BE±0.10R):",
    `${fmtPrice(pos.slCurrent ?? pos.levels.entryMid)}`,
    "",
    "🟡 Status: RUNNING",
    "━━━━━━━━━━━━━━━━━━"
  ].join("\n");
}