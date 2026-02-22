const DIVIDER = "──────────────────────────────";

export function cooldownCard({ mode, retryInSeconds } = {}) {
  const modeLabel = String(mode || "").toUpperCase() || "TARGETED";
  const retry = Number(retryInSeconds || 0);

  return [
    "🤖 CLOUD TREND ALERT",
    DIVIDER,
    "⏳ COOLDOWN ACTIVE",
    "",
    `• Mode: ${modeLabel}`,
    `• Try again in: ${retry}s`,
    "",
    "🛠️ TIP",
    "• Use /scan <PAIR> to target a symbol",
    DIVIDER,
    "⚠️ Not Financial Advice"
  ].join("\n");
}
