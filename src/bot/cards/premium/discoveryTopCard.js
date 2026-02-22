const DIVIDER = "──────────────────────────────";
const TF_ORDER = ["15m", "30m", "1h", "4h"];

function normalizeTf(tf) {
  return String(tf || "").trim().toLowerCase();
}

function formatTfList(tfs) {
  const list = Array.isArray(tfs) ? tfs : [];
  const uniq = [];
  const seen = new Set();
  for (const raw of list) {
    const tf = normalizeTf(raw);
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
  return uniq.length ? uniq.join(" / ") : "N/A";
}

export function discoveryTopCard({ scannedCount, timeframes, scoreThreshold, setups, cooldownSeconds } = {}) {
  const rows = Array.isArray(setups) ? setups : [];
  const lines = [
    "🤖 CLOUD TREND ALERT",
    DIVIDER,
    "🔎 DISCOVERY RESULTS",
    "",
    "📌 CHECKED",
    `• Scanned: ${Number(scannedCount || 0)} pairs`,
    `• Timeframes: ${formatTfList(timeframes)}`,
    `• Minimum quality: score ≥ ${Number(scoreThreshold || 80)}`,
    "",
    "🏆 TOP SETUPS"
  ];

  rows.forEach((row, idx) => {
    const n = idx + 1;
    const sym = String(row?.symbol || "").toUpperCase();
    const tf = normalizeTf(row?.tf);
    const score = Number.isFinite(Number(row?.score)) ? Math.round(Number(row.score)) : 0;
    lines.push(`• #${n} ${sym} — ${tf} — Score ${score}`);
  });

  lines.push(
    "",
    "⏳ COOLDOWN",
    `• ${Number(cooldownSeconds || 0)}s`,
    DIVIDER,
    "⚠️ Not Financial Advice"
  );

  return lines.join("\n");
}
