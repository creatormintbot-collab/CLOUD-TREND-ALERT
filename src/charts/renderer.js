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

function fillRect(setPixel, x, y, w, h, rgba) {
  const x0 = Math.round(x), y0 = Math.round(y);
  const x1 = Math.round(x + w), y1 = Math.round(y + h);
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) setPixel(xx, yy, rgba);
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
  if (n >= 1000) return n.toFixed(2);
  if (n >= 100) return n.toFixed(3);
  return n.toFixed(4);
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
  for (const k of ["entryLow","entryHigh","entryMid","sl","tp1","tp2","tp3"]) {
    const v = Number(lv[k]);
    if (Number.isFinite(v) && v > 0) { minP = Math.min(minP, v); maxP = Math.max(maxP, v); }
  }

  if (!Number.isFinite(minP) || !Number.isFinite(maxP)) return placeholderPngBuffer();
  const pad = (maxP - minP) * 0.06;
  minP -= pad; maxP += pad;

  const width = 900, height = 520;
  const png = new Png({ width, height });
  const setPixel = mkSetPixel(png);

  fill(png, [255, 255, 255, 255]);

  const left = 40, right = 160, top = 20, bottom = height - 30;
  const plotW = (width - right) - left;
  const step = plotW / Math.max(1, N - 1);
  const bodyW = Math.max(2, Math.floor(step * 0.6));

  drawLine(setPixel, left, top, left, bottom, [0, 0, 0, 255]);
  drawLine(setPixel, left, bottom, width - right, bottom, [0, 0, 0, 255]);

  const drawLevel = (price, rgbaLine, label) => {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return;
    const y = priceToY(p, minP, maxP, top, bottom);
    drawLine(setPixel, left, y, width - right, y, rgbaLine);
    const txt = label || fmtPrice(p);
    const xText = width - right + 10;
    const yText = Math.round(y) - 4;
    fillRect(setPixel, xText - 2, yText - 2, 120, 14, [255, 255, 255, 255]);
    drawText5x7(setPixel, xText, yText, txt, [0, 0, 0, 255], 1);
  };

  if (Number.isFinite(Number(lv.entryLow)) && Number.isFinite(Number(lv.entryHigh))) {
    const y1 = priceToY(lv.entryHigh, minP, maxP, top, bottom);
    const y2 = priceToY(lv.entryLow, minP, maxP, top, bottom);
    const yTop = Math.min(y1, y2);
    const h = Math.abs(y2 - y1);
    fillRect(setPixel, left + 1, yTop, plotW - 1, h, [245, 245, 245, 255]);
  }

  for (let i = 0; i < view.length; i++) {
    const c = view[i];
    const x = left + i * step;

    const o = Number(c.open), h = Number(c.high), l = Number(c.low), cl = Number(c.close);
    const yO = priceToY(o, minP, maxP, top, bottom);
    const yH = priceToY(h, minP, maxP, top, bottom);
    const yL = priceToY(l, minP, maxP, top, bottom);
    const yC = priceToY(cl, minP, maxP, top, bottom);

    drawLine(setPixel, x, yH, x, yL, [0, 0, 0, 255]);
    const up = cl >= o;
    const yTopBody = Math.min(yO, yC);
    const bodyH = Math.max(1, Math.abs(yC - yO));
    const color = up ? [0, 140, 0, 255] : [200, 0, 0, 255];
    fillRect(setPixel, x - bodyW / 2, yTopBody, bodyW, bodyH, color);
  }

  const drawEma = (arr, rgba) => {
    if (!Array.isArray(arr) || arr.length < candles.length) return;
    const emaView = arr.slice(-N);
    let prev = null;
    for (let i = 0; i < emaView.length; i++) {
      const v = emaView[i];
      if (!Number.isFinite(v)) { prev = null; continue; }
      const x = left + i * step;
      const y = priceToY(v, minP, maxP, top, bottom);
      if (prev) drawLine(setPixel, prev.x, prev.y, x, y, rgba);
      prev = { x, y };
    }
  };

  drawEma(overlays.ema21, [0, 0, 200, 255]);
  drawEma(overlays.ema55, [120, 0, 120, 255]);
  drawEma(overlays.ema200, [80, 80, 80, 255]);

  drawLevel(lv.entryMid, [0, 0, 0, 255], fmtPrice(lv.entryMid));
  drawLevel(lv.sl, [200, 0, 0, 255], `-${fmtPrice(lv.sl)}`.replace("--", "-"));
  drawLevel(lv.tp1, [0, 140, 0, 255], fmtPrice(lv.tp1));
  drawLevel(lv.tp2, [0, 140, 0, 255], fmtPrice(lv.tp2));
  drawLevel(lv.tp3, [0, 140, 0, 255], fmtPrice(lv.tp3));
  if (Number.isFinite(Number(lv.entryLow))) drawLevel(lv.entryLow, [180, 180, 180, 255], fmtPrice(lv.entryLow));
  if (Number.isFinite(Number(lv.entryHigh))) drawLevel(lv.entryHigh, [180, 180, 180, 255], fmtPrice(lv.entryHigh));

  try { return Png.sync.write(png); } catch { return placeholderPngBuffer(); }
}
