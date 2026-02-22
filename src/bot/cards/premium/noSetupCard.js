import { reasonBullets } from "./reasonMap.js";

const DIVIDER = "──────────────────────────────";
const TF_ORDER = ["15m", "30m", "1h", "4h"];

function normalizeTfList(tfs) {
  const list = Array.isArray(tfs) ? tfs : [];
  const uniq = [];
  const seen = new Set();

  for (const raw of list) {
    const tf = String(raw || "").trim().toLowerCase();
    if (!tf || seen.has(tf)) continue;
    seen.add(tf);
    uniq.push(tf);
  }

  uniq.sort((a, b) => {
    const ai = TF_ORDER.indexOf(a);
    const bi = TF_ORDER.indexOf(b);
    const aIdx = ai === -1 ? TF_ORDER.length : ai;
    const bIdx = bi === -1 ? TF_ORDER.length : bi;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.localeCompare(b);
  });

  return uniq;
}

function formatTfList(tfs) {
  const list = normalizeTfList(tfs);
  return list.length ? list.join(" / ") : "N/A";
}

function formatReasonLines(reasonCodes, minCandles, scoreThreshold) {
  const bullets = reasonBullets(reasonCodes, { minCandles, scoreThreshold, maxBullets: 3 });
  return bullets.map((b) => `• ${b}`);
}

export function noSetupCard(opts = {}) {
  const variant = String(opts.variant || "").toUpperCase();
  const symbol = String(opts.symbol || "").toUpperCase();
  const tf = String(opts.tf || "").toLowerCase();
  const timeframes = Array.isArray(opts.timeframes) ? opts.timeframes : [];
  const tfNoSetupList = Array.isArray(opts.tfNoSetupList) ? opts.tfNoSetupList : timeframes;
  const scannedCount = Number(opts.scannedCount || 0);
  const scoreThreshold = Number(opts.scoreThreshold || 80);
  const cooldownSeconds = Number(opts.cooldownSeconds || 0);
  const minCandles = Number(opts.minCandles || 220);

  const reasonLines = formatReasonLines(opts.reasonCodes, minCandles, scoreThreshold);

  if (variant === "DISCOVERY") {
    return [
      "🤖 CLOUD TREND ALERT",
      DIVIDER,
      "🚫 NO SETUP FOUND",
      "",
      "🔎 DISCOVERY",
      `• Scanned: ${scannedCount} pairs`,
      `• Timeframes: ${formatTfList(timeframes)}`,
      `• Minimum quality: score ≥ ${scoreThreshold}`,
      "",
      "🧠 WHY THIS CAN HAPPEN",
      ...reasonLines,
      "",
      "🛠️ WHAT YOU CAN DO",
      "• Retry after 1–2 candle closes",
      "• Tip: Use /scan <PAIR> to target a symbol directly",
      "",
      "⏳ COOLDOWN",
      `• ${cooldownSeconds}s`,
      DIVIDER,
      "⚠️ Not Financial Advice"
    ].join("\n");
  }

  if (variant === "TARGETED_SINGLE") {
    return [
      "🤖 CLOUD TREND ALERT",
      DIVIDER,
      "🚫 NO SETUP FOUND",
      "",
      "🎯 REQUEST",
      "• Mode: Targeted",
      `• Symbol: ${symbol}`,
      `• Timeframe: ${tf}`,
      "",
      "📌 CHECKED",
      `• ${tf}`,
      "",
      "🧠 WHY THIS CAN HAPPEN",
      ...reasonLines,
      "",
      "🛠️ WHAT YOU CAN DO",
      "• Retry after 1–2 candle closes",
      "• Try another timeframe",
      `• Tip: Use /scan ${symbol} to check 15m / 30m / 1h / 4h`,
      "",
      "⏳ COOLDOWN",
      `• ${cooldownSeconds}s`,
      DIVIDER,
      "⚠️ Not Financial Advice"
    ].join("\n");
  }

  const tfList = formatTfList(timeframes);
  const checkedList = formatTfList(tfNoSetupList);
  const tipTf = normalizeTfList(timeframes)[0] || "15m";

  return [
    "🤖 CLOUD TREND ALERT",
    DIVIDER,
    "🚫 NO SETUP FOUND",
    "",
    "🎯 REQUEST",
    "• Mode: Targeted",
    `• Symbol: ${symbol}`,
    `• Timeframes: ${tfList}`,
    "",
    "📌 CHECKED",
    `• No setup validated on: ${checkedList}`,
    "",
    "🧠 WHY THIS CAN HAPPEN",
    ...reasonLines,
    "",
    "🛠️ WHAT YOU CAN DO",
    "• Retry after 1–2 candle closes",
    "• Try another pair",
    `• Tip: Use /scan ${symbol} ${tipTf} to focus one timeframe`,
    "",
    "⏳ COOLDOWN",
    `• ${cooldownSeconds}s`,
    DIVIDER,
    "⚠️ Not Financial Advice"
  ].join("\n");
}
