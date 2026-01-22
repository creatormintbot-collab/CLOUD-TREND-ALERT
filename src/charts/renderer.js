import { placeholderPngBuffer } from "./pngPlaceholder.js";
import { drawText5x7 } from "./font5x7.js";

async function tryLoadPngjs() {
  try {
    const mod = await import("pngjs");
    return mod?.PNG || mod?.default?.PNG || mod?.default || mod;
  } catch {
    return null;
  }
}

function mkSetPixel(png) {
  const w = png.width;
  const h = png.height;
  return (x, y, rgba) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (w * y + x) << 2;
    png.data[i] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  };
}

function fill(png, rgba) {
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = rgba[0]; d[i + 1] = rgba[1]; d[i + 2] = rgba[2]; d[i + 3] = rgba[3];
  }
}

function drawLine(setPixel, x0, y0, x1, y1, rgba) {
  x0 = Math.round(x0); y0 = Math.round(y0);
  x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    setPixel(x0, y0, rgba);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function drawDashedHLine(setPixel, x0, x1, y, rgba, dash = 8, gap = 6) {
  y = Math.round(y);
  const start = Math.round(Math.min(x0, x1));
  const end = Math.round(Math.max(x0, x1));
  let x = start;
  while (x <= end) {
    const xx1 = Math.min(end, x + dash);
    drawLine(setPixel, x, y, xx1, y, rgba);
    x += dash + gap;
  }
}

function fillRect(setPixel, x, y, w, h, rgba) {
  const x0 = Math.round(x), y0 = Math.round(y);
  const x1 = Math.round(x + w), y1 = Math.round(y + h);
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) setPixel(xx, yy, rgba);
}

function strokeRect(setPixel, x, y, w, h, rgba) {
  drawLine(setPixel, x, y, x + w, y, rgba);
  drawLine(setPixel, x, y + h, x + w, y + h, rgba);
  drawLine(setPixel, x, y, x, y + h, rgba);
  drawLine(setPixel, x + w, y, x + w, y + h, rgba);
}

function priceToY(price, minP, maxP, top, bottom) {
  const p = Number(price);
  if (!Number.isFinite(p) || maxP === minP) return bottom;
  const t = (p - minP) / (maxP - minP);
  return bottom - t * (bottom - top);
}

function fmtPrice(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "";
  const a = Math.abs(n);
  if (a >= 1000) return n.toFixed(2);
  if (a >= 100) return n.toFixed(3);
  if (a >= 1) return n.toFixed(4);
  if (a >= 0.1) return n.toFixed(5);
  if (a >= 0.01) return n.toFixed(6);
  if (a >= 0.001) return n.toFixed(7);
  return n.toFixed(8);
}

function fmtPct(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "";
  return `${Math.round(n)}%`;
}

function estimateTextW(text, scale = 2) {
  const s = String(text || "");
  // 5x7 font: approx 6px per char incl spacing
  return Math.max(0, (s.length * 6 - 1) * scale);
}

function drawChip(setPixel, x, y, text, { bg = [255, 255, 255, 255], fg = [0, 0, 0, 255], border = [0, 0, 0, 255], scale = 2, padX = 6, padY = 4 } = {}) {
  const t = String(text || "");
  const w = estimateTextW(t, scale) + padX * 2;
  const h = 7 * scale + padY * 2;

  fillRect(setPixel, x, y, w, h, bg);
  strokeRect(setPixel, x, y, w, h, border);
  drawText5x7(setPixel, x + padX, y + padY, t, fg, scale);
  return { w, h };
}

function drawBox(setPixel, x, y, w, h, { bg = [255, 255, 255, 255], border = [0, 0, 0, 255] } = {}) {
  fillRect(setPixel, x, y, w, h, bg);
  strokeRect(setPixel, x, y, w, h, border);
}

function drawLabelOnLine(setPixel, x, y, text, opts) {
  // label box centered on y
  const scale = opts?.scale ?? 2;
  const padX = opts?.padX ?? 6;
  const padY = opts?.padY ?? 4;
  const bg = opts?.bg ?? [255, 255, 255, 255];
  const fg = opts?.fg ?? [0, 0, 0, 255];
  const border = opts?.border ?? [0, 0, 0, 255];

  const t = String(text || "");
  const w = estimateTextW(t, scale) + padX * 2;
  const h = 7 * scale + padY * 2;

  const yy = Math.round(y - h / 2);
  drawBox(setPixel, x, yy, w, h, { bg, border });
  drawText5x7(setPixel, x + padX, yy + padY, t, fg, scale);
}

function utcLabel(ms) {
  const d = new Date(Number(ms));
  if (!Number.isFinite(d.getTime())) return "";
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} UTC`;
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function computeRR({ side, entry, sl, tp }) {
  const E = safeNum(entry);
  const SL = safeNum(sl);
  const TP = safeNum(tp);
  if (E === null || SL === null || TP === null) return null;

  const s = String(side || "").toUpperCase();
  if (s === "LONG") {
    const risk = E - SL;
    const reward = TP - E;
    if (risk <= 0 || reward <= 0) return null;
    return reward / risk;
  }

  const risk = SL - E;
  const reward = E - TP;
  if (risk <= 0 || reward <= 0) return null;
  return reward / risk;
}

export async function renderEntryChart(signal, overlays) {
  const Png = await tryLoadPngjs();
  if (!Png) return placeholderPngBuffer();

  const candles = overlays?.candles || [];
  if (!candles.length) return placeholderPngBuffer();

  const N = Math.min(120, candles.length);
  const view = candles.slice(-N);

  let minP = Infinity, maxP = -Infinity;
  for (const c of view) {
    minP = Math.min(minP, Number(c.low));
    maxP = Math.max(maxP, Number(c.high));
  }

  const lv = overlays?.levels || {};
  for (const k of ["entryLow", "entryHigh", "entryMid", "sl", "tp1", "tp2", "tp3"]) {
    const v = Number(lv[k]);
    if (Number.isFinite(v) && v > 0) { minP = Math.min(minP, v); maxP = Math.max(maxP, v); }
  }

  if (!Number.isFinite(minP) || !Number.isFinite(maxP)) return placeholderPngBuffer();
  const pad = (maxP - minP) * 0.08;
  minP -= pad; maxP += pad;

  // NOTE: keep function signature + fallback behavior intact.
  // Update: richer chart (volume + chips + level labels) to match requested style.
  const width = 1280, height = 720;
  const png = new Png({ width, height });
  const setPixel = mkSetPixel(png);

  fill(png, [255, 255, 255, 255]);

  // Layout
  const headerH = 54;
  const volH = 150;
  const gap = 14;

  const left = 56;
  const right = 28;
  const top = 18 + headerH;
  const volTop = height - 36 - volH;
  const priceTop = top;
  const priceBottom = volTop - gap;

  const plotW = (width - right) - left;
  const priceH = priceBottom - priceTop;
  const step = plotW / Math.max(1, N - 1);
  const bodyW = Math.max(2, Math.floor(step * 0.62));

  // Header title (center-ish)
  const sym = String(signal?.symbol || signal?.pair || signal?.market || "").toUpperCase() || "";
  const tf = String(signal?.tf || signal?.timeframe || signal?.interval || "").toLowerCase() || "";
  const ex = String(signal?.exchange || "BINANCE").toUpperCase();
  const last = view[view.length - 1];
  const title = `${sym || "PAIR"} • ${tf || "tf"} • ${utcLabel(last?.closeTime || last?.openTime || Date.now())} • ${ex}`;
  drawText5x7(setPixel, left + 290, 24, title, [0, 0, 0, 255], 2);

  // Badges (top-left)
  const side = String(signal?.side || signal?.direction || "SHORT").toUpperCase();
  const conf = Number(signal?.confidence ?? signal?.conf ?? lv?.confidence ?? 0);
  const isShort = side === "SHORT";
  const chipX = left - 8;
  let chipY = 18;

  drawChip(setPixel, chipX, chipY, isShort ? "▼ SHORT" : "▲ LONG", {
    bg: isShort ? [255, 107, 107, 255] : [46, 204, 113, 255],
    fg: [0, 0, 0, 255],
    border: [0, 0, 0, 255],
    scale: 2
  });
  chipY += 28;
  drawChip(setPixel, chipX, chipY, `Confidence: ${fmtPct(conf)}`, {
    bg: [255, 210, 74, 255],
    fg: [0, 0, 0, 255],
    border: [0, 0, 0, 255],
    scale: 2
  });

  // Axes
  drawLine(setPixel, left, priceTop, left, priceBottom, [0, 0, 0, 255]);
  drawLine(setPixel, left, priceBottom, width - right, priceBottom, [0, 0, 0, 255]);

  drawLine(setPixel, left, volTop, left, height - 36, [0, 0, 0, 255]);
  drawLine(setPixel, left, height - 36, width - right, height - 36, [0, 0, 0, 255]);

  // Entry zone shading across full plot (existing behavior, slightly darker)
  if (Number.isFinite(Number(lv.entryLow)) && Number.isFinite(Number(lv.entryHigh))) {
    const y1 = priceToY(lv.entryHigh, minP, maxP, priceTop, priceBottom);
    const y2 = priceToY(lv.entryLow, minP, maxP, priceTop, priceBottom);
    const yTop = Math.min(y1, y2);
    const h = Math.abs(y2 - y1);
    fillRect(setPixel, left + 1, yTop, plotW - 1, h, [245, 245, 245, 255]);
  }

  // Candles
  for (let i = 0; i < view.length; i++) {
    const c = view[i];
    const x = left + i * step;

    const o = Number(c.open), h = Number(c.high), l = Number(c.low), cl = Number(c.close);
    const yO = priceToY(o, minP, maxP, priceTop, priceBottom);
    const yH = priceToY(h, minP, maxP, priceTop, priceBottom);
    const yL = priceToY(l, minP, maxP, priceTop, priceBottom);
    const yC = priceToY(cl, minP, maxP, priceTop, priceBottom);

    const up = cl >= o;
    const wick = up ? [27, 195, 182, 255] : [241, 104, 108, 255];
    drawLine(setPixel, x, yH, x, yL, wick);

    const yTopBody = Math.min(yO, yC);
    const bodyH = Math.max(1, Math.abs(yC - yO));
    const body = up ? [27, 195, 182, 255] : [241, 104, 108, 255];
    fillRect(setPixel, x - bodyW / 2, yTopBody, bodyW, bodyH, body);
  }

  // Risk/Reward overlay (right zone)
  const entry = Number.isFinite(Number(lv.entryMid)) ? Number(lv.entryMid)
    : Number.isFinite(Number(lv.limit)) ? Number(lv.limit)
    : (Number.isFinite(Number(lv.entryLow)) && Number.isFinite(Number(lv.entryHigh)))
      ? (Number(lv.entryLow) + Number(lv.entryHigh)) / 2
      : null;

  const sl = Number.isFinite(Number(lv.sl)) ? Number(lv.sl) : null;
  const tpTgt = Number.isFinite(Number(lv.tp2)) ? Number(lv.tp2)
    : Number.isFinite(Number(lv.tp1)) ? Number(lv.tp1) : null;

  if (entry !== null && sl !== null && tpTgt !== null) {
    const xZone = left + Math.round(plotW * 0.72);
    const wZone = (width - right) - xZone;

    const yEntry = priceToY(entry, minP, maxP, priceTop, priceBottom);
    const ySL = priceToY(sl, minP, maxP, priceTop, priceBottom);
    const yTP = priceToY(tpTgt, minP, maxP, priceTop, priceBottom);

    if (isShort) {
      // Risk above entry
      fillRect(setPixel, xZone, Math.min(ySL, yEntry), wZone, Math.abs(ySL - yEntry), [255, 107, 107, 40]);
      // Reward below entry
      fillRect(setPixel, xZone, Math.min(yTP, yEntry), wZone, Math.abs(yTP - yEntry), [55, 214, 196, 40]);
    } else {
      // Risk below entry
      fillRect(setPixel, xZone, Math.min(yEntry, ySL), wZone, Math.abs(yEntry - ySL), [255, 107, 107, 40]);
      // Reward above entry
      fillRect(setPixel, xZone, Math.min(yEntry, yTP), wZone, Math.abs(yEntry - yTP), [55, 214, 196, 40]);
    }
  }

  // EMA overlays (existing behavior)
  const drawEma = (arr, rgba) => {
    if (!Array.isArray(arr) || arr.length < candles.length) return;
    const emaView = arr.slice(-N);
    let prev = null;
    for (let i = 0; i < emaView.length; i++) {
      const v = emaView[i];
      if (!Number.isFinite(v)) { prev = null; continue; }
      const x = left + i * step;
      const y = priceToY(v, minP, maxP, priceTop, priceBottom);
      if (prev) drawLine(setPixel, prev.x, prev.y, x, y, rgba);
      prev = { x, y };
    }
  };

  drawEma(overlays.ema21, [0, 140, 255, 255]);   // blue
  drawEma(overlays.ema55, [255, 140, 0, 255]);   // orange
  drawEma(overlays.ema200, [50, 170, 90, 255]);  // green

  // Levels (dashed lines + labeled boxes like screenshot)
  const labelX = left + Math.round(plotW * 0.58);

  const drawLevel = (price, rgbaLine, labelText, labelBg) => {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return;
    const y = priceToY(p, minP, maxP, priceTop, priceBottom);
    drawDashedHLine(setPixel, left, width - right, y, rgbaLine, 10, 7);
    drawLabelOnLine(setPixel, labelX, y, labelText, {
      bg: labelBg,
      fg: [0, 0, 0, 255],
      border: [0, 0, 0, 255],
      scale: 2
    });
  };

  // SL, LIMIT/ENTRY, TP1/TP2/TP3
  if (sl !== null) drawLevel(sl, [255, 107, 107, 255], `SL: ${fmtPrice(sl)}`, [255, 107, 107, 255]);
  if (entry !== null) drawLevel(entry, [0, 140, 255, 255], `Limit: ${fmtPrice(entry)}`, [42, 167, 255, 255]);
  if (Number.isFinite(Number(lv.tp1))) drawLevel(lv.tp1, [55, 214, 196, 255], `TP1: ${fmtPrice(lv.tp1)}`, [55, 214, 196, 255]);
  if (Number.isFinite(Number(lv.tp2))) drawLevel(lv.tp2, [55, 214, 196, 255], `TP2: ${fmtPrice(lv.tp2)}`, [55, 214, 196, 255]);
  if (Number.isFinite(Number(lv.tp3))) drawLevel(lv.tp3, [55, 214, 196, 255], `TP3: ${fmtPrice(lv.tp3)}`, [55, 214, 196, 255]);

  // Current label (yellow chip)
  const cur = Number(last?.close);
  if (Number.isFinite(cur)) {
    const yCur = priceToY(cur, minP, maxP, priceTop, priceBottom);
    drawLabelOnLine(setPixel, left + Math.round(plotW * 0.25), yCur, `Current: ${fmtPrice(cur)}`, {
      bg: [255, 210, 74, 255],
      fg: [0, 0, 0, 255],
      border: [0, 0, 0, 255],
      scale: 2
    });
  }

  // Volume panel
  let maxV = 0;
  for (const c of view) maxV = Math.max(maxV, Number(c.volume || 0));
  maxV = maxV > 0 ? maxV : 1;
  const volBottom = height - 36;
  const volPlotH = volBottom - volTop;
  const volBarW = Math.max(2, Math.floor(step * 0.62));

  for (let i = 0; i < view.length; i++) {
    const c = view[i];
    const x = left + i * step;
    const v = Number(c.volume || 0);
    const h = Math.round((v / maxV) * volPlotH);
    const y = volBottom - h;
    const up = Number(c.close) >= Number(c.open);
    const col = up ? [27, 195, 182, 255] : [241, 104, 108, 255];
    fillRect(setPixel, x - volBarW / 2, y, volBarW, h, col);
  }

  // POSITION box (left) like screenshot
  const rr = computeRR({ side, entry, sl, tp: tpTgt });
  const boxX = left + 10;
  const boxY = priceTop + Math.round(priceH * 0.50);
  const boxW = 230;
  const lines = [
    "POSITION",
    `Side : ${isShort ? "SHORT" : "LONG"}`,
    `Conf : ${fmtPct(conf)}`,
    "",
    `Entry : ${fmtPrice(entry)}`,
    `SL    : ${fmtPrice(sl)}`,
    `TP1   : ${fmtPrice(lv.tp1)}`,
    `TP2   : ${fmtPrice(lv.tp2)}`,
    `RR    : ${rr ? rr.toFixed(2) : "-"}`
  ];

  // box height based on lines
  const scale = 2;
  const lineH = 10 * scale;
  const padX = 10;
  const padY = 10;
  const boxH = padY * 2 + lines.length * (7 * scale + 6);

  drawBox(setPixel, boxX, boxY, boxW, boxH, {
    bg: [255, 255, 255, 255],
    border: [0, 0, 0, 255]
  });

  let ty = boxY + padY;
  for (const ln of lines) {
    drawText5x7(setPixel, boxX + padX, ty, ln, [0, 0, 0, 255], scale);
    ty += 7 * scale + 6;
  }

  try { return Png.sync.write(png); } catch { return placeholderPngBuffer(); }
}