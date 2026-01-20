import { fmtPrice, fmtSignedInt, fmtScore } from "../../utils/format.js";

export function entryCard(sig) {
  const dirEmoji = sig.direction === "LONG" ? "🟢" : "🔴";
  const p = sig.points || {};
  const m = sig.macro || {};
  return [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    `🚀 FUTURES SIGNAL — ${dirEmoji} ${sig.direction}`,
    `🪙 Pair: ${sig.symbol}`,
    `⏱ Timeframe: ${sig.tf}`,
    "",
    "🎯 Entry Zone:",
    `${fmtPrice(sig.levels.entryLow)} – ${fmtPrice(sig.levels.entryHigh)}`,
    "⚖️ Mid Entry:",
    `${fmtPrice(sig.levels.entryMid)}`,
    "",
    "🛑 Stop Loss:",
    `${fmtPrice(sig.levels.sl)}`,
    "",
    "🎯 Take Profit:",
    `TP1: ${fmtPrice(sig.levels.tp1)} (25%)`,
    `TP2: ${fmtPrice(sig.levels.tp2)} (50%)`,
    `TP3: ${fmtPrice(sig.levels.tp3)} (100%)`,
    "",
    `📊 Score: ${fmtScore(sig.score)} / 100`,
    "",
    "📊 Score Factors:",
    `📐 EMA ${fmtSignedInt(p.EMA)} | 🌊 Pullback ${fmtSignedInt(p.Pullback)} | 📊 RSI ${fmtSignedInt(p.RSI)} | 🧱 ADX ${fmtSignedInt(p.ADX)} | 🧨 Risk ${fmtSignedInt(p.Risk)} | 📉 MACD ${fmtSignedInt(p.MACD)} | 📏 SMA ${fmtSignedInt(p.SMA)} | 🌍 Macro ${fmtSignedInt(p.Macro)}`,
    "",
    "🌍 Macro Context:",
    `₿ BTC: ${m.BTC_STATE || "NEUTRAL"} | 🪙 ALTS: ${m.ALT_STATE || "NEUTRAL"}`,
    `⚡ Bias: ${m.BIAS || "NEUTRAL"}`,
    "━━━━━━━━━━━━━━━━━━",
    "⚠️ Not Financial Advice"
  ].join("\n");
}
