export function buildExplainText(payload) {
  const { symbol, timeframe, direction, base, adv, macro } = payload;

  const lines = [];
  lines.push(`<b>Why this signal?</b>`);
  lines.push(`🪙 <b>${symbol}</b> · ${timeframe} · <b>${direction}</b>`);
  lines.push(`━━━━━━━━━━━━━━━━━━`);
  lines.push(`<b>Base Score</b>`);
  lines.push(`• Trend EMA: +${base.factors.trend}`);
  lines.push(`• RSI Momentum: +${base.factors.rsi}`);
  lines.push(`• ADX Strength: +${base.factors.adx}`);
  lines.push(`• ATR%: +${base.factors.atr}`);
  lines.push(`• Pullback (EMA21 touch): +${base.factors.pullback}`);
  lines.push(`━━━━━━━━━━━━━━━━━━`);
  lines.push(`<b>Advanced Layers</b>`);
  lines.push(`• FVG: +${adv.factorScores.fvg}`);
  lines.push(`• MACD: +${adv.factorScores.macd}`);
  lines.push(`• Volume: +${adv.factorScores.volume}`);
  lines.push(`━━━━━━━━━━━━━━━━━━`);
  lines.push(`<b>Macro</b>`);
  lines.push(`• BTC: ${macro.btcTrend} | ALT: ${macro.altStrength}`);
  lines.push(`• Bias: ${macro.bias} (adj ${macro.adj >= 0 ? "+" : ""}${macro.adj})`);
  return lines.join("\n");
}
