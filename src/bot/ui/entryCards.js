import { tvSymbolPerp, roundToTick } from "../../config/constants.js";
import { signalStrengthLabel } from "../../selection/selector.js";
import { ENV } from "../../config/env.js";

function fmt(n) {
  if (!Number.isFinite(n)) return "-";
  // adaptive decimals
  const abs = Math.abs(n);
  const dp = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return n.toFixed(dp);
}

export function buildEntryCard({ symbol, timeframe, direction, levels, score, base, adv, macro, analysisLines }) {
  const strength = signalStrengthLabel(score);
  const tv = tvSymbolPerp(symbol);

  const zoneLow = fmt(levels.entryZoneLow);
  const zoneHigh = fmt(levels.entryZoneHigh);

  const html = [
    `🤖 <b>${ENV.BOT_NAME}</b>`,
    `<b>AI Trading Assistant — Entry Signal</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `🪙 <b>Symbol:</b> ${symbol}   ${direction === "LONG" ? "🟢" : "🔴"} <b>${direction}</b>`,
    `🕒 <b>Timeframe:</b> ${timeframe}`,
    `📌 <b>Order:</b> LIMIT (PENDING)`,
    `━━━━━━━━━━━━━━━━━━`,
    `🎯 <b>Entry Zone:</b> ${zoneLow} – ${zoneHigh}`,
    `🧮 <b>Mid Entry:</b> ${fmt(levels.entryMid)}`,
    `🛡️ <b>SL:</b> ${fmt(levels.sl)}`,
    `🎯 <b>TP1:</b> ${fmt(levels.tp1)}`,
    `🎯 <b>TP2:</b> ${fmt(levels.tp2)}`,
    `🎯 <b>TP3:</b> ${fmt(levels.tp3)}`,
    `━━━━━━━━━━━━━━━━━━`,
    `🧠 <b>Confidence Score:</b> ${Math.round(score)}%`,
    `🔥 <b>Signal Strength:</b> ${strength}`,
    `━━━━━━━━━━━━━━━━━━`,
    `🧾 <b>Analysis:</b>`,
    ...analysisLines.map((x) => `• ${x}`),
    `━━━━━━━━━━━━━━━━━━`,
    `✅ <b>Score Factors:</b>`,
    `• Trend EMA: +${base.factors.trend}`,
    `• Pullback: +${base.factors.pullback}`,
    `• MACD: +${adv.factorScores.macd}`,
    `• RSI: +${base.factors.rsi}`,
    `• Volume: +${adv.factorScores.volume}`,
    `• FVG: +${adv.factorScores.fvg}`,
    `• Macro: ${macro.adj >= 0 ? "+" : ""}${macro.adj}`,
    `━━━━━━━━━━━━━━━━━━`,
    `🌍 <b>Macro Context</b>`,
    `• TF: ${macro.tf}`,
    `• BTC: ${macro.btcTrend} | ALT: ${macro.altStrength}`,
    `• Bias: ${macro.bias} (adj ${macro.adj >= 0 ? "+" : ""}${macro.adj})`,
    `━━━━━━━━━━━━━━━━━━`,
    `🔗 <b>Lihat Chart:</b> ${tv}`,
    `⚠️ <i>Not Financial Advice</i>`,
  ].join("\n");

  const buttons = [
    [
      { text: "Open TradingView", url: tv },
      { text: "Why this signal?", callback_data: `WHY:${symbol}:${timeframe}:${direction}:${Math.round(score)}` },
    ],
  ];

  return { html, buttons };
}
