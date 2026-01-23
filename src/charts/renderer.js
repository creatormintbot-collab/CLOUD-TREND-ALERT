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

async function tryLoadCanvas() {
  // Prefer prebuilt canvas (@napi-rs/canvas) to avoid native deps on VPS.
  // Fallback to node-canvas ("canvas") if needed.
  try {
    const mod = await import("@napi-rs/canvas");
    const createCanvas = mod?.createCanvas || mod?.default?.createCanvas;
    if (createCanvas) return createCanvas;
  } catch {
    // ignore
  }

  try {
    const mod = await import("canvas");
    const createCanvas = mod?.createCanvas || mod?.default?.createCanvas;
    return createCanvas || null;
  } catch (e) {
    // Optional debug: set CHART_RENDERER_DEBUG=1
    if (process?.env?.CHART_RENDERER_DEBUG === "1") {
      console.warn("[charts] canvas unavailable, falling back to pngjs:", e?.message || e);
    }
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

function inferSide(signal) {
  const s = String(signal?.side || signal?.direction || signal?.signal || "").toUpperCase();
  if (s.includes("LONG")) return "LONG";
  if (s.includes("SHORT")) return "SHORT";
  // fallback: if provided boolean-ish
  if (signal?.isLong === true) return "LONG";
  if (signal?.isShort === true) return "SHORT";
  return "SHORT";
}

function inferConfidence(signal) {
  const raw = Number(signal?.confidence ?? signal?.conf ?? signal?.score ?? signal?.finalScore ?? 0);
  if (!Number.isFinite(raw)) return 0;
  // accept 0..1 or 0..100
  if (raw > 0 && raw <= 1) return Math.round(raw * 100);
  return Math.round(raw);
}

function inferMeta(signal, view) {
  const symbol = String(signal?.symbol || signal?.pair || signal?.market || "").toUpperCase() || "PAIR";
  const tf = String(signal?.tf || signal?.timeframe || signal?.interval || "").toLowerCase() || "tf";
  const exchange = String(signal?.exchange || "BINANCE").toUpperCase();
  const last = view?.[view.length - 1];
  const ts = Number(last?.closeTime || last?.openTime || Date.now());
  return { symbol, tf, exchange, ts };
}

function computeRR(side, entry, sl, tp) {
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
  // SHORT
  const risk = SL - E;
  const reward = E - TP;
  if (risk <= 0 || reward <= 0) return null;
  return reward / risk;
}

function renderWithCanvas(createCanvas, signal, overlays) {
  try {
    const candlesRaw = overlays?.candles || [];
    if (!candlesRaw.length) return null;

    const candles = candlesRaw
      .filter((c) => c && Number.isFinite(Number(c.close)))
      .slice()
      .sort((a, b) => Number(a.closeTime) - Number(b.closeTime));

    const N = Math.min(140, candles.length);
    const view = candles.slice(-N);

    const lv = overlays?.levels || {};
    const entryLow = safeNum(lv.entryLow);
    const entryHigh = safeNum(lv.entryHigh);
    const entryMid = safeNum(lv.entryMid) ?? ((entryLow !== null && entryHigh !== null) ? (entryLow + entryHigh) / 2 : null);
    const sl = safeNum(lv.sl);
    const tp1 = safeNum(lv.tp1);
    const tp2 = safeNum(lv.tp2);
    const tp3 = safeNum(lv.tp3);

    // price bounds include levels
    let minP = Infinity, maxP = -Infinity;
    for (const c of view) {
      minP = Math.min(minP, Number(c.low));
      maxP = Math.max(maxP, Number(c.high));
    }
    for (const v of [entryLow, entryHigh, entryMid, sl, tp1, tp2, tp3]) {
      if (v !== null && v > 0) { minP = Math.min(minP, v); maxP = Math.max(maxP, v); }
    }
    if (!Number.isFinite(minP) || !Number.isFinite(maxP) || minP === maxP) return null;
    const pad = (maxP - minP) * 0.12;
    minP -= pad; maxP += pad;

    const side = inferSide(signal);
    const confidence = inferConfidence(signal);
    const { symbol, tf, exchange, ts } = inferMeta(signal, view);
    const title = `${symbol} • ${tf} • ${utcLabel(ts)} • ${exchange}`;

    // layout (match screenshot proportions; higher res for crispness)
    const width = 1600;
    const height = 900;
    const padL = 80, padR = 40, padT = 24, padB = 26;
    const titleH = 44;
    const gap = 18;
    const volH = Math.round((height - padT - padB - titleH - gap) * 0.25);
    const priceH = (height - padT - padB - titleH - gap) - volH;

    const priceRect = { x: padL, y: padT + titleH, w: width - padL - padR, h: priceH };
    const volRect = { x: padL, y: padT + titleH + priceH + gap, w: width - padL - padR, h: volH };

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // theme like screenshot
    const COLORS = {
      bg: "#ffffff",
      grid: "rgba(0,0,0,0.06)",
      border: "rgba(0,0,0,0.85)",
      bull: "rgba(27,195,182,1)",   // teal
      bear: "rgba(241,104,108,1)",  // red/pink
      blue: "rgba(0,120,255,1)",
      orange: "rgba(255,140,0,1)",
      green: "rgba(40,160,90,1)",
      dark: "rgba(18,18,18,0.92)",
      chipBorder: "rgba(0,0,0,0.75)",
      yellow: "#ffd24a",
      risk: "rgba(241,104,108,0.18)",
      reward: "rgba(27,195,182,0.18)",
    };

    const yOf = (p) => {
      const t = (p - minP) / (maxP - minP);
      return priceRect.y + priceRect.h * (1 - t);
    };

    const roundRect = (x, y, w, h, r = 7) => {
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    };

    const chip = (x, y, text, bg) => {
      ctx.save();
      ctx.font = "bold 20px Arial";
      const padX = 14;
      const w = Math.ceil(ctx.measureText(text).width + padX * 2);
      const h = 30;
      const x0 = Math.min(Math.max(x, priceRect.x + 6), priceRect.x + priceRect.w - w - 6);
      roundRect(x, y, w, h, 7);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLORS.chipBorder;
      ctx.stroke();
      ctx.fillStyle = "#111";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x + padX, y + h / 2 + 0.5);
      ctx.restore();
      return { w, h };
    };

    const valueTag = (x, y, text, color) => {
      ctx.save();
      ctx.font = "bold 20px Arial";
      const padX = 14;
      const w = Math.ceil(ctx.measureText(text).width + padX * 2);
      const h = 30;
      const x0 = Math.min(Math.max(x, priceRect.x + 6), priceRect.x + priceRect.w - w - 6);
      roundRect(x0, y - h / 2, w, h, 7);
      ctx.fillStyle = COLORS.dark;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLORS.chipBorder;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.textBaseline = "middle";
      ctx.fillText(text, x0 + padX, y + 0.5);
      ctx.restore();
      return { w, h };
    };

    const dashedH = (y, color, dash = [10, 7], lw = 3) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(priceRect.x, y);
      ctx.lineTo(priceRect.x + priceRect.w, y);
      ctx.stroke();
      ctx.restore();
    };

    const grid = (rect, rows = 5, cols = 9) => {
      ctx.save();
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      for (let i = 0; i <= rows; i++) {
        const yy = rect.y + (rect.h * i) / rows;
        ctx.beginPath();
        ctx.moveTo(rect.x, yy);
        ctx.lineTo(rect.x + rect.w, yy);
        ctx.stroke();
      }
      for (let j = 0; j <= cols; j++) {
        const xx = rect.x + (rect.w * j) / cols;
        ctx.beginPath();
        ctx.moveTo(xx, rect.y);
        ctx.lineTo(xx, rect.y + rect.h);
        ctx.stroke();
      }
      ctx.restore();
    };

    const border = (rect) => {
      ctx.save();
      ctx.strokeStyle = COLORS.border;
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
    };

    // background + outer frame
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, width - 16, height - 16);
    ctx.restore();

    // title (center)
    ctx.save();
    ctx.font = "bold 26px Arial";
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    ctx.fillText(title, width / 2, padT + 8);
    ctx.restore();

    // badges top-left
    let bx = padL - 10, by = padT + 8;
    const dir = side === "SHORT" ? "▼ SHORT" : "▲ LONG";
    chip(bx, by, dir, side === "SHORT" ? "#ff6b6b" : "#2ecc71");
    by += 38;
    chip(bx, by, `Confidence: ${confidence}%`, COLORS.yellow);

    // grid + borders
    grid(priceRect, 5, 9);
    grid(volRect, 2, 9);
    border(priceRect);
    border(volRect);

        // candles coords
    // Reserve a fixed label column on the right so TP/SL/Entry tags sit in the empty area
    // (match the reference style where labels are not drawn over candles).
    const LABEL_COL_W = 280;
    const LABEL_COL_GAP = 10;
    const candlePlotW = Math.max(120, priceRect.w - LABEL_COL_W - LABEL_COL_GAP);
    const step = candlePlotW / view.length;
    const bodyW = Math.max(4, Math.floor(step * 0.62));
    const candleEndX = priceRect.x + candlePlotW;
    const labelColX = candleEndX + LABEL_COL_GAP;

    // risk/reward shaded zones on right
    const entryForBox = entryMid;
    const tpForBox = tp2 ?? tp1 ?? tp3;
    if (entryForBox !== null && sl !== null && tpForBox !== null) {
            const xStart = labelColX;
      const yE = yOf(entryForBox);
      const ySL = yOf(sl);
      const yTP = yOf(tpForBox);

      ctx.save();
      if (side === "SHORT") {
        // risk (above entry)
        ctx.fillStyle = COLORS.risk;
        ctx.fillRect(xStart, Math.min(ySL, yE), priceRect.x + priceRect.w - xStart, Math.abs(ySL - yE));
        // reward (below entry)
        ctx.fillStyle = COLORS.reward;
        ctx.fillRect(xStart, Math.min(yTP, yE), priceRect.x + priceRect.w - xStart, Math.abs(yTP - yE));
      } else {
        // risk (below entry)
        ctx.fillStyle = COLORS.risk;
        ctx.fillRect(xStart, Math.min(yE, ySL), priceRect.x + priceRect.w - xStart, Math.abs(yE - ySL));
        // reward (above entry)
        ctx.fillStyle = COLORS.reward;
        ctx.fillRect(xStart, Math.min(yE, yTP), priceRect.x + priceRect.w - xStart, Math.abs(yTP - yE));
      }
      ctx.restore();
    }

    // draw candles
    for (let i = 0; i < view.length; i++) {
      const c = view[i];
      const xMid = priceRect.x + step * (i + 0.5);

      const o = Number(c.open), h = Number(c.high), l = Number(c.low), cl = Number(c.close);
      const yO = yOf(o), yH = yOf(h), yL = yOf(l), yC = yOf(cl);

      const up = cl >= o;
      const col = up ? COLORS.bull : COLORS.bear;

      // wick
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xMid, yH);
      ctx.lineTo(xMid, yL);
      ctx.stroke();
      ctx.restore();

      // body
      const topB = Math.min(yO, yC);
      const hB = Math.max(2, Math.abs(yC - yO));
      ctx.save();
      ctx.fillStyle = col;
      ctx.fillRect(Math.floor(xMid - bodyW / 2), Math.floor(topB), bodyW, Math.floor(hB));
      ctx.restore();
    }

    // draw EMA overlays (anti-aliased)
    const drawMA = (arr, color, lw = 3) => {
      if (!Array.isArray(arr) || arr.length < candles.length) return;
      const series = arr.slice(-N);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < series.length; i++) {
        const v = series[i];
        if (!Number.isFinite(v)) { started = false; continue; }
        const x = priceRect.x + step * (i + 0.5);
        const y = yOf(v);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    };

    drawMA(overlays.ema21, COLORS.blue, 3);
    drawMA(overlays.ema55, COLORS.orange, 3);
    drawMA(overlays.ema200, COLORS.green, 3);
    if (overlays.ema100) drawMA(overlays.ema100, "rgba(230,40,40,1)", 3);
    if (overlays.sma100) drawMA(overlays.sma100, "rgba(230,40,40,1)", 3);

    // level lines + labels    const labelX = labelColX + 12;
    const placed = [];
    const placeY = (y) => {
      let yy = y;
      for (let k = 0; k < 10; k++) {
        const collide = placed.some((p) => Math.abs(p - yy) < 30);
        if (!collide) break;
        yy += 32;
      }
      placed.push(yy);
      return yy;
    };

    const lastC = Number(view[view.length - 1].close);

    // Current label
    {
      const y = yOf(lastC);
      const x = priceRect.x + priceRect.w * 0.24;
      valueTag(x, y, `Current: ${fmtPrice(lastC)}`, COLORS.yellow);
    }

    if (sl !== null) {
      const y = yOf(sl);
      dashedH(y, COLORS.bear, [10, 7], 3);
      valueTag(labelX, placeY(y), `SL: ${fmtPrice(sl)}`, COLORS.bear);
    }

    if (entryMid !== null) {
      const y = yOf(entryMid);
      dashedH(y, COLORS.blue, [10, 7], 3);
      valueTag(labelX, placeY(y), `Entry: ${fmtPrice(entryMid)}`, COLORS.blue);
    }

    const tpColor = COLORS.bull;
    const tpDash = [8, 6];
    if (tp1 !== null) {
      const y = yOf(tp1);
      dashedH(y, tpColor, tpDash, 3);
      valueTag(labelX, placeY(y), `TP1: ${fmtPrice(tp1)}`, tpColor);
    }
    if (tp2 !== null) {
      const y = yOf(tp2);
      dashedH(y, tpColor, tpDash, 3);
      valueTag(labelX, placeY(y), `TP2: ${fmtPrice(tp2)}`, tpColor);
    }
    if (tp3 !== null) {
      const y = yOf(tp3);
      dashedH(y, tpColor, tpDash, 3);
      valueTag(labelX, placeY(y), `TP3: ${fmtPrice(tp3)}`, tpColor);
    }

    // volume bars
    let vmax = 0;
    for (const c of view) vmax = Math.max(vmax, Number(c.volume || 0));
    vmax = Math.max(1, vmax);

    const stepV = volRect.w / view.length;
    const bodyWV = Math.max(4, Math.floor(stepV * 0.62));

    for (let i = 0; i < view.length; i++) {
      const c = view[i];
      const v = Number(c.volume || 0);
      const up = Number(c.close) >= Number(c.open);
      const col = up ? COLORS.bull : COLORS.bear;

            const xMid = volRect.x + stepV * (i + 0.5);
      const h = Math.round((v / vmax) * (volRect.h - 6));
            const x = Math.floor(xMid - bodyWV / 2);
      const y = Math.floor(volRect.y + volRect.h - h);

      ctx.save();
      ctx.fillStyle = col;
      ctx.fillRect(x, y, bodyW, h);
      ctx.restore();
    }

    // POSITION box (left)
    const rr = computeRR(side, entryMid, sl, (tp2 ?? tp1 ?? tp3));
    const boxX = priceRect.x + 10;
    const boxY = priceRect.y + Math.round(priceRect.h * 0.44);
    const boxW = 260;
    const lines = [
      "POSITION",
      `Side : ${side}`,
      `Conf : ${confidence}%`,
      "",
      `Entry: ${fmtPrice(entryMid)}`,
      `SL   : ${fmtPrice(sl)}`,
      `TP1  : ${fmtPrice(tp1)}`,
      `TP2  : ${fmtPrice(tp2)}`,
      `RR   : ${rr ? rr.toFixed(2) : "-"}`,
    ];

    ctx.save();
    ctx.font = "17px Arial";
    const padX = 14, padY = 12, lineH = 22;
    const boxH = padY * 2 + lineH * lines.length;
    roundRect(boxX, boxY, boxW, boxH, 10);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    let yy = boxY + padY;
    for (const ln of lines) {
      ctx.fillText(ln, boxX + padX, yy);
      yy += lineH;
    }
    ctx.restore();

    return canvas.toBuffer("image/png");
  } catch {
    return null;
  }
}

export async function renderEntryChart(signal, overlays) {
  // Prefer anti-aliased canvas renderer (matches desired screenshot). Fallback to PNGJS pixel renderer.
  const createCanvas = await tryLoadCanvas();
  if (createCanvas) {
    if (process?.env?.CHART_RENDERER_DEBUG === "1") console.warn("[charts] using canvas renderer");
    const buf = renderWithCanvas(createCanvas, signal, overlays);
    if (buf) return buf;
    if (process?.env?.CHART_RENDERER_DEBUG === "1") console.warn("[charts] canvas renderer returned null; falling back to pngjs");
  }

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
