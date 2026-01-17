import { BOT_NAME, EMOJI } from "../../config/constants.js";

function fmt(n) {
  if (n == null) return "-";
  // keep nice decimals based on magnitude
  const d = n >= 100 ? 2 : n >= 10 ? 3 : 4;
  return Number(n).toFixed(d);
}

function tvLink(symbol, tf) {
  const s = symbol.replace("USDT", "USDT.P");
  return `https://www.tradingview.com/chart/?symbol=BINANCE:${s}&interval=${tf}`;
}

export function entryCard({ signal }) {
  const {
    symbol,
    direction,
    timeframe,
    entryZoneLow,
    entryZoneHigh,
    entryMid,
    sl,
    tp1,
    tp2,
    tp3,
    score,
    macro
  } = signal;

  const dirEmoji = direction === "LONG" ? EMOJI.long : EMOJI.short;

  const factorsLine = [
    `📐 EMA +${score.breakdown.trendScore}`,
    `🌊 Pullback +${score.breakdown.pullbackScore}`,
    `${EMOJI.macd} MACD +${score.breakdown.macdScore}`,
    `📊 RSI +${score.breakdown.rsiScore}`,
    `${EMOJI.volume} Volume +${score.breakdown.volScore}`,
    `${EMOJI.fvg} FVG +${score.breakdown.fvgScore}`,
    `${EMOJI.macro} Macro ${score.breakdown.macroScore >= 0 ? "+" : ""}${score.breakdown.macroScore}`
  ].join(" | ");

  return (
`🤖 <b>${BOT_NAME}</b>
🧠 <b>AI Futures Signal Generated</b>
━━━━━━━━━━━━━━━━━━
${EMOJI.pair} Pair: ${symbol}   ${dirEmoji} ${direction}
${EMOJI.tf} Timeframe: ${timeframe}
${EMOJI.order} Order: LIMIT (PENDING)
━━━━━━━━━━━━━━━━━━
${EMOJI.entryZone} Entry Zone: ${fmt(entryZoneLow)} – ${fmt(entryZoneHigh)}
${EMOJI.midEntry} Mid Entry: ${fmt(entryMid)}
${EMOJI.sl} Stop Loss: ${fmt(sl)}
${EMOJI.entryZone} TP1: ${fmt(tp1)}
${EMOJI.tp2} TP2: ${fmt(tp2)}
${EMOJI.tp3} TP3: ${fmt(tp3)}
━━━━━━━━━━━━━━━━━━
${EMOJI.brain} Confidence Score: ${Math.round(score.finalScore)}% 🔥
━━━━━━━━━━━━━━━━━━
${EMOJI.factors} Score Factors:
${factorsLine}
━━━━━━━━━━━━━━━━━━
${EMOJI.macro} Macro Context:
📈 BTC ${macro?.btc ?? "NEUTRAL"} | 📈 ALT ${macro?.alt ?? "NEUTRAL"}
⚡ Bias: ${macro?.bias ?? "NEUTRAL"}
━━━━━━━━━━━━━━━━━━
🔗 Chart: ${tvLink(symbol, timeframe)}
⚠️ Not Financial Advice`
  );
}

export function tpCard({ position, type, suggestedSL, actions }) {
  const dirEmoji = position.direction === "LONG" ? EMOJI.long : EMOJI.short;
  const statusEmoji = EMOJI.running;

  const title =
    type === "TP1" ? `${EMOJI.tp1} <b>TP1 HIT</b>`
    : type === "TP2" ? `${EMOJI.tp2} <b>TP2 HIT</b>`
    : `${EMOJI.tp3} <b>TP3 HIT</b>`;

  const suggested = suggestedSL == null ? "-" : fmt(suggestedSL);

  return (
`🤖 <b>${BOT_NAME}</b>
${title}  ${statusEmoji} RUNNING
━━━━━━━━━━━━━━━━━━
${EMOJI.pair} Pair: ${position.symbol}   ${dirEmoji} ${position.direction}
${EMOJI.tf} Timeframe: ${position.timeframe}
━━━━━━━━━━━━━━━━━━
${EMOJI.entryZone} Entry Zone: ${fmt(position.entryZoneLow)} – ${fmt(position.entryZoneHigh)}
${EMOJI.midEntry} Mid Entry: ${fmt(position.entryMid)}
${EMOJI.sl} Current SL: ${fmt(position.sl)}
━━━━━━━━━━━━━━━━━━
📌 Action Logic:
• ${actions.join("\n• ")}
━━━━━━━━━━━━━━━━━━
🛡️ Suggested SL:
• ${suggested}
━━━━━━━━━━━━━━━━━━
🔗 Chart: ${tvLink(position.symbol, position.timeframe)}
⚠️ Not Financial Advice`
  );
}

export function slCard({ position }) {
  const dirEmoji = position.direction === "LONG" ? EMOJI.long : EMOJI.short;
  return (
`🤖 <b>${BOT_NAME}</b>
${EMOJI.slHit} <b>STOP LOSS HIT</b>  ${EMOJI.closedLoss} CLOSED LOSS
━━━━━━━━━━━━━━━━━━
${EMOJI.pair} Pair: ${position.symbol}   ${dirEmoji} ${position.direction}
${EMOJI.tf} Timeframe: ${position.timeframe}
━━━━━━━━━━━━━━━━━━
${EMOJI.entryZone} Entry Zone: ${fmt(position.entryZoneLow)} – ${fmt(position.entryZoneHigh)}
${EMOJI.midEntry} Mid Entry: ${fmt(position.entryMid)}
${EMOJI.sl} SL: ${fmt(position.sl)}
━━━━━━━━━━━━━━━━━━
🔗 Chart: ${tvLink(position.symbol, position.timeframe)}
⚠️ Not Financial Advice`
  );
}

export function closedProfitCard({ position, reason }) {
  const dirEmoji = position.direction === "LONG" ? EMOJI.long : EMOJI.short;
  return (
`🤖 <b>${BOT_NAME}</b>
${EMOJI.tp3} <b>POSITION CLOSED</b>  ${EMOJI.closedProfit} CLOSED PROFIT
━━━━━━━━━━━━━━━━━━
${EMOJI.pair} Pair: ${position.symbol}   ${dirEmoji} ${position.direction}
${EMOJI.tf} Timeframe: ${position.timeframe}
━━━━━━━━━━━━━━━━━━
Reason: ${reason ?? "TP3"}
━━━━━━━━━━━━━━━━━━
🔗 Chart: ${tvLink(position.symbol, position.timeframe)}
⚠️ Not Financial Advice`
  );
}

export function noSignalCard({ symbol, tf, reasons }) {
  return (
`🤖 <b>${BOT_NAME}</b>
🧠 <b>NO SIGNAL</b>
━━━━━━━━━━━━━━━━━━
${EMOJI.pair} Pair: ${symbol ?? "TOP"}   ${EMOJI.tf} TF: ${tf ?? "-"}
━━━━━━━━━━━━━━━━━━
📌 Reasons:
• ${reasons.join("\n• ")}
━━━━━━━━━━━━━━━━━━
⚠️ Not Financial Advice`
  );
}

export function dailyRecapCard({ recap }) {
  const lines = [
    `📅 Date (UTC): ${recap.day}`,
    `📨 Signals Sent: ${recap.signalsSent}`,
    `🟡 Running: ${recap.running}`,
    `${EMOJI.closedProfit} Closed Profit: ${recap.closedProfit}`,
    `${EMOJI.closedLoss} Closed Loss: ${recap.closedLoss}`
  ].join("\n");

  return (
`🤖 <b>${BOT_NAME}</b>
📣 <b>DAILY RECAP</b>
━━━━━━━━━━━━━━━━━━
${lines}
━━━━━━━━━━━━━━━━━━
⚠️ Not Financial Advice`
  );
}
