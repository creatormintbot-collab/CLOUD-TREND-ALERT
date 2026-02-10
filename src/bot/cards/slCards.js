// File: src/bot/cards/slCards.js
import { fmtPrice } from "../../utils/format.js";
import { logger } from "../../logger/logger.js";
import { getMilestonesFromEvents } from "../../positions/outcomes.js";


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


export function slCard(pos, events = []) {
  const pb = resolvePlaybook(pos);
  const conf = confluenceActive(pos);
  const derived = getMilestonesFromEvents(events);
  const tp2Hit = derived.tp2 || derived.tp3;
  const tp1Hit = derived.tp1 || tp2Hit;

  let chosenCopy = "before_tp1";
  if (tp2Hit) chosenCopy = "after_tp2";
  else if (tp1Hit) chosenCopy = "after_tp1";

  logger.info("[SL_CARD] derived", {
    positionId: pos?.id ?? events?.[0]?.positionId ?? null,
    derived,
    chosenCopy
  });

  if (!tp1Hit) {
    return [
      "🤖 CLOUD TREND ALERT",
      "───────────────────",
      "🛑 STOP LOSS HIT",
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
      "🛑 Stop Loss Hit:",
      `${fmtPrice(pos.levels.sl)}`,
      "",
      "🧨 Result:",
      "• SL hit before TP1",
      "• Risk managed",
      "",
      "🔴 Status: CLOSED (STOP_LOSS)",
      "━━━━━━━━━━━━━━━━━━"
    ].join("\n");
  }

  if (!tp2Hit) {
    return [
      "🤖 CLOUD TREND ALERT",
      "───────────────────",
      "🛑 PRICE REVERSED — STOP LOSS HIT",
      `🪙 Pair: ${pos.symbol}`,
      `Mode: ${modeLabel(pb)}`,
      `Signal TF: ${pos.tf}`,
      conf ? `Confluence: Intraday + Swing` : null,
      "",
      "✅ TP1 was hit (partial profit secured)",
      "Price reversed",
      "SL was hit",
      "",
      "🧨 Result:",
      "• TP1 secured partial profit",
      "• SL hit after reversal",
      "",
      "🟢 Status: CLOSED (WIN — PARTIAL / STOP_LOSS_AFTER_TP1)",
      "━━━━━━━━━━━━━━━━━━"
    ].join("\n");
  }

  return [
    "🤖 CLOUD TREND ALERT",
    "───────────────────",
    "🛑 PRICE REVERSED — STOP LOSS HIT",
    `🪙 Pair: ${pos.symbol}`,
    `Mode: ${modeLabel(pb)}`,
    `Signal TF: ${pos.tf}`,
    conf ? `Confluence: Intraday + Swing` : null,
    "",
    "✅ TP1 & TP2 were hit",
    "Price reversed",
    "SL was hit",
    "",
    "🧨 Result:",
    "• TP1 & TP2 secured partial profit",
    "• SL hit after reversal",
    "",
    "🟢 Status: CLOSED (WIN — PARTIAL / STOP_LOSS_AFTER_TP2)",
    "━━━━━━━━━━━━━━━━━━"
  ].join("\n");
}
