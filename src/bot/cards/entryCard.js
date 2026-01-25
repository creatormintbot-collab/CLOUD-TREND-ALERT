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


export function entryHitCard(pos, price) {
  const dirEmoji = pos.direction === "LONG" ? "🟢" : "🔴";
  const pb = resolvePlaybook(pos);
  const conf = confluenceActive(pos);
  return [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    `✅ ENTRY CONFIRMED — ${dirEmoji} ${pos.direction}`,
    `🪙 Pair: ${pos.symbol}`,
    `Mode: ${modeLabel(pb)}`,
    `Signal TF: ${pos.tf}`,
    conf ? `Confluence: Intraday + Swing` : null,
    "",
    `🎯 Fill Price: ${fmtPrice(price)}`,
    "",
    "Monitoring TP/SL...",
  ].join("\n");
}

export function entryCard(s) {
  const dirRaw = String(s?.direction || s?.side || s?.signal || "LONG").toUpperCase();
  const dir = dirRaw === "SHORT" ? "SHORT" : "LONG";
  const dot = dir === "LONG" ? "🟢" : "🔴";


  const pb = resolvePlaybook(s);
  const conf = confluenceActive(s);

  const sym = s?.symbol || s?.pair || "N/A";
  const tf = s?.tf || s?.timeframe || "N/A";

  const levels = s?.levels || {};
  const entryLow = levels.entryLow ?? s?.entryLow ?? s?.entry?.low;
  const entryHigh = levels.entryHigh ?? s?.entryHigh ?? s?.entry?.high;
  const entryMid = levels.entryMid ?? s?.entryMid ?? s?.midEntry ?? s?.entry?.mid;

  const sl = levels.sl ?? s?.sl ?? s?.stopLoss;

  const tp1 = levels.tp1 ?? s?.tp1;
  const tp2 = levels.tp2 ?? s?.tp2;
  const tp3 = levels.tp3 ?? s?.tp3;

  const score = Number.isFinite(Number(s?.score)) ? Number(s.score) : null;

  const fmt = (v) => {
    if (v === null || v === undefined) return "N/A";
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    if (Math.abs(n) >= 1000) return n.toFixed(2);
    if (Math.abs(n) >= 1) return n.toFixed(4);
    return n.toFixed(4);
  };

  const scoreLine = score === null
    ? "📊 Score: N/A"
    : `📊 Score: ${Math.round(score)} / 100`;

  // Prefer a prebuilt line if your scoring already formats emojis + points.
  let factorsLine =
    s?.scoreFactorsLine ||
    s?.factorsLine ||
    (typeof s?.scoreFactors === "string" ? s.scoreFactors : null) ||
    null;

  if (!factorsLine) {
    const f = s?.factors || s?.scoreBreakdown || null;
    if (Array.isArray(f)) {
      factorsLine = f.map((x) => {
        const name = x?.name || x?.label || x?.key;
        const val = x?.score ?? x?.value ?? x?.points;
        if (!name || val === undefined) return null;
        const n = Number(val);
        if (Number.isFinite(n)) return `${name} ${n >= 0 ? "+" : ""}${n}`;
        return `${name} ${val}`;
      }).filter(Boolean).join(" | ");
    } else if (f && typeof f === "object") {
      factorsLine = Object.entries(f).map(([k, v]) => {
        const n = Number(v);
        if (Number.isFinite(n)) return `${k} ${n >= 0 ? "+" : ""}${n}`;
        return `${k} ${v}`;
      }).join(" | ");
    }
  }

  const macro = s?.macro || s?.macroContext || {};
  const btc = macro?.btc ?? macro?.BTC ?? null;
  const alts = macro?.alts ?? macro?.ALTS ?? null;
  const bias = macro?.bias ?? macro?.BIAS ?? null;

  const lines = [
    "CLOUD TREND ALERT",
    "────────────────────────────────",
    `🚀 FUTURES SIGNAL — ${dot} ${dir}`,
    `🌕 Pair: ${sym}`,
    `Mode: ${modeLabel(pb)}`,
    `Signal TF: ${tf}`,
    conf ? `Confluence: Intraday + Swing` : null,
    "",
    "🎯 Entry Zone:",
    `${fmt(entryLow)} – ${fmt(entryHigh)}`,
    "⚖️ Mid Entry:",
    `${fmt(entryMid)}`,
    "",
    "🛑 Stop Loss:",
    `${fmt(sl)}`,
    "",
    "🎯 Take Profit:",
    `TP1: ${fmt(tp1)} (25%)`,
    `TP2: ${fmt(tp2)} (50%)`,
    `TP3: ${fmt(tp3)} (100%)`,
    "",
    scoreLine,
  ];

  if (factorsLine) {
    lines.push("", "📊 Score Factors:", String(factorsLine));
  }

  if (btc || alts || bias) {
    lines.push(
      "",
      "🌍 Macro Context:",
      `฿ BTC: ${btc ?? "N/A"} | 🌕 ALTS: ${alts ?? "N/A"}`,
      `⚡ Bias: ${bias ?? "N/A"}`
    );
  }

  lines.push("", "⚠️ Not Financial Advice");
  return lines.join("\n");
}
