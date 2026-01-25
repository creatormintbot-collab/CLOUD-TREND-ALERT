import { ema } from "./indicators/ema.js";
import { sma } from "./indicators/sma.js";
import { rsi } from "./indicators/rsi.js";
import { atr } from "./indicators/atr.js";
import { adx } from "./indicators/adx.js";
import { macd } from "./indicators/macd.js";

import { baseScore } from "./scoring/baseScore.js";
import { proScore, macdGate } from "./scoring/proScore.js";
import { finalScore } from "./scoring/finalScore.js";
import { btcMacro } from "./macro/btcMacro.js";
import { ctaProTrendGate } from "./ctaProTrend.js";

import {
  HTF_HARD_GATE_ENABLED,
  HTF_BLOCK_ON_RECLAIM_NOT_CONFIRMED,
  HTF_MAX_EMA21_DIST_ATR,
  CHOP_FILTER_ENABLED,
  CHOP_MIN_ADX,
  CHOP_MIN_ATR_PCT,
  CHOP_MIN_EMA_SEP_ATR,
  TRIGGER_CONFIRM_ENABLED,
  TRIGGER_REQUIRE_CLOSE_RECLAIM_EMA21,
  TRIGGER_REQUIRE_RSI_TURN,
  TRIGGER_REQUIRE_MACD_HIST_TURN,
} from "../config/constants.js";


// Ichimoku (9,26,52,26) HTF compass (LOCKED): used as direction filter on 4H.
// For /scan: NEUTRAL/UNKNOWN is allowed but penalized in score.
// For AUTO: NEUTRAL/UNKNOWN is rejected (hard gate).

function clampNum(x, lo, hi) {
  const n = Number(x);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function normTf(tf) {
  return String(tf || "").trim().toLowerCase();
}

function isSwingTf(tf, env) {
  const swing = normTf(env?.SECONDARY_TIMEFRAME || "4h");
  return normTf(tf) === swing;
}

function playbookForTf(tf, env) {
  return isSwingTf(tf, env) ? "SWING" : "INTRADAY";
}


function scoreLabelFromScore(score) {
  const s = Number(score);
  if (s >= 90) return "ELITE";
  if (s >= 80) return "STRONG";
  if (s >= 70) return "OK";
  return "NO SIGNAL";
}

function _midHighLow(candles, period) {
  const out = Array((candles || []).length).fill(null);
  const p = Number(period);
  if (!Array.isArray(candles) || !Number.isFinite(p) || p <= 0) return out;

  for (let i = p - 1; i < candles.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - p + 1; j <= i; j++) {
      const h = Number(candles[j]?.high);
      const l = Number(candles[j]?.low);
      if (Number.isFinite(h) && h > hi) hi = h;
      if (Number.isFinite(l) && l < lo) lo = l;
    }
    if (hi > -Infinity && lo < Infinity) out[i] = (hi + lo) / 2;
  }
  return out;
}

function ichimokuCompass(candles, opts = {}) {
  const tenkanP = Number(opts.tenkan ?? 9);
  const kijunP = Number(opts.kijun ?? 26);
  const spanBP = Number(opts.senkouB ?? 52);
  const disp = Number(opts.displacement ?? 26);

  const need = Math.max(spanBP + disp + 5, 90);
  if (!Array.isArray(candles) || candles.length < need) {
    return { ok: false, bias: "UNKNOWN", reason: "INSUFFICIENT_DATA", have: Array.isArray(candles) ? candles.length : 0, need };
  }

  const tenkan = _midHighLow(candles, tenkanP);
  const kijun = _midHighLow(candles, kijunP);
  const spanB = _midHighLow(candles, spanBP);
  const spanA = tenkan.map((t, i) => (t != null && kijun[i] != null ? (t + kijun[i]) / 2 : null));

  const idx = candles.length - 1;
  const leadIdx = idx - disp;

  const close = Number(candles[idx]?.close);
  const a = spanA[leadIdx];
  const b = spanB[leadIdx];

  if (!Number.isFinite(close) || a == null || b == null) {
    return { ok: false, bias: "UNKNOWN", reason: "INDICATORS_NOT_READY" };
  }

  const cloudTop = Math.max(a, b);
  const cloudBottom = Math.min(a, b);

  const tkNow = tenkan[idx];
  const kjNow = kijun[idx];
  let tk = "NEUTRAL";
  if (tkNow != null && kjNow != null) {
    if (tkNow > kjNow) tk = "BULL";
    else if (tkNow < kjNow) tk = "BEAR";
  }

  let bias = "NEUTRAL";
  if (close > cloudTop && a > b) bias = "BULL";
  else if (close < cloudBottom && a < b) bias = "BEAR";

  const distPct =
    close > cloudTop
      ? ((close - cloudTop) / close) * 100
      : (close < cloudBottom ? ((cloudBottom - close) / close) * 100 : 0);

  return {
    ok: true,
    bias,
    tk,
    spanA: a,
    spanB: b,
    cloudTop,
    cloudBottom,
    distanceToCloudPct: distPct
  };
}


function levelsFromATR({ direction, entryMid, atrVal, zoneMult, slMult, tpRMults = null }) {
  const zoneSize = atrVal * zoneMult;
  const entryLow = entryMid - zoneSize;
  const entryHigh = entryMid + zoneSize;

  const slDist = atrVal * slMult;
  const sl = direction === "LONG" ? entryMid - slDist : entryMid + slDist;

  // R is defined as |Entry - SL| (LOCK). Keep SL logic as-is, only adjust TP R-multipliers by playbook.
  const R = Math.abs(entryMid - sl);

  // Backward-compatible defaults (legacy behaviour) if tpRMults is not provided.
  const m1 = Number(tpRMults?.[0] ?? 1.2);
  const m2 = Number(tpRMults?.[1] ?? 2.0);
  const m3 = Number(tpRMults?.[2] ?? 3.0);

  const sgn = direction === "LONG" ? 1 : -1;
  const tp1 = entryMid + sgn * R * m1;
  const tp2 = entryMid + sgn * R * m2;
  const tp3 = entryMid + sgn * R * m3;

  return { entryLow, entryHigh, entryMid, sl, tp1, tp2, tp3, slDist, R, tpRMults: [m1, m2, m3] };
}

function pickTrendTf(entryTf, thresholds, env) {
  // Precedence: explicit override (thresholds/env) > derived mapping by entry TF > default "4h"
  const explicit = String(thresholds?.TREND_TF || env?.TREND_TF || "").trim();
  if (explicit) return explicit;

  const tf = String(entryTf || "").toLowerCase();
  if (tf === "15m") return "4h";
  if (tf === "30m") return "4h";
  if (tf === "1h") return "4h";
  if (tf === "4h") return "4h";
  return "4h";
}

function computeCore({ symbol, tf, klines, thresholds, env = {}, isAuto }) {
  const candles = klines.getCandles(symbol, tf);
  if (!candles || candles.length < 220) {
    return { ok: false, reason: "INSUFFICIENT_DATA", metrics: { have: candles?.length || 0, need: 220 } };
  }

  const last = candles[candles.length - 1];
  const close = Number(last.close);
  const closes = candles.map((c) => Number(c.close));

  const ema21 = ema(closes, 21);
  const ema55 = ema(closes, 55);
  const ema200 = ema(closes, 200);

  const rr = rsi(closes, 14);
  const aa = atr(candles, 14);
  const dd = adx(candles, 14);

  const sm = sma(closes, 20);
  const mc = macd(closes, 12, 26, 9);

  const i = candles.length - 1;
  const e21 = ema21[i], e55 = ema55[i], e200 = ema200[i];
  const r14 = rr[i], atr14 = aa[i], adx14 = dd[i];
  const r14Prev = rr[i - 1];

  if (e55 == null || e200 == null || e21 == null || r14 == null || atr14 == null || adx14 == null) {
    return { ok: false, reason: "INDICATORS_NOT_READY", metrics: {} };
  }

  const longTrend = e55 > e200;
  const shortTrend = e55 < e200;

  let direction = null;
  if (longTrend) direction = "LONG";
  else if (shortTrend) direction = "SHORT";

  const atrPct = atr14 / close;
  const distAtr = Math.abs(close - e21) / (atr14 || 1e-9);

  const pbAuto = Number(thresholds.PULLBACK_MAX_ATR_AUTO ?? env.PULLBACK_MAX_ATR_AUTO ?? 0.65);
  const pbScan = Number(thresholds.PULLBACK_MAX_ATR_SCAN ?? env.PULLBACK_MAX_ATR_SCAN ?? 0.75);
  const pbMax = isAuto ? pbAuto : pbScan;

  const pullbackOk = distAtr <= pbMax;

  // CTA PRO TREND (optional) - HTF regime gate + direction lock
  const STRATEGY = String(env?.STRATEGY || thresholds?.STRATEGY || "").toUpperCase();
  const ctaGate = ctaProTrendGate({
    strategy: STRATEGY,
    symbol,
    entryTf: tf,
    trendTf: pickTrendTf(tf, thresholds, env),
    klines,
    thresholds,
    isAuto,
    entryCandles: candles
  });

  // If CTA is enabled and provides a directional bias (BULL/BEAR), prefer that direction.
  // This prevents countertrend "flip" on noisy entry TFs, while your score engine remains the quality gate.
  if (ctaGate?.enabled && ctaGate?.direction) {
    direction = ctaGate.direction;
  }

  // Ichimoku HTF compass (LOCKED): use secondary TF (typically 4h) for direction bias.
  const ichiTf = String(env?.SECONDARY_TIMEFRAME || "4h");
  const ichiCandles =
    String(tf || "").toLowerCase() === String(ichiTf || "").toLowerCase()
      ? candles
      : (klines?.getCandles?.(symbol, ichiTf) || []);
  const ichimoku = { tf: ichiTf, ...ichimokuCompass(ichiCandles) };


  const macroBase = btcMacro({ klines, rsiBull: thresholds.RSI_BULL_MIN, rsiBear: thresholds.RSI_BEAR_MAX });

  let MACRO_PTS = 0;
  if (macroBase.BIAS === "RISK_ON" && direction === "LONG") MACRO_PTS = 8;
  else if (macroBase.BIAS === "RISK_OFF" && direction === "SHORT") MACRO_PTS = 8;
  else if (macroBase.BIAS === "RISK_ON" && direction === "SHORT") MACRO_PTS = -8;
  else if (macroBase.BIAS === "RISK_OFF" && direction === "LONG") MACRO_PTS = -8;

  const macro = { ...macroBase, MACRO_PTS };

  const base = direction
    ? baseScore({
        direction,
        ema55: e55,
        ema200: e200,
        ema21: e21,
        close,
        atr: atr14,
        rsi: r14,
        adx: adx14,
        atrPct,
        thresholds
      })
    : { total: 0, parts: { EMA: 0, PULLBACK: 0, RSI: 0, ADX: 0, RISK: 0 } };

  const pro = direction
    ? proScore({
        direction,
        close,
        sma20: sm[i],
        macdLine: mc.macdLine,
        signalLine: mc.signalLine,
        hist: mc.hist,
        macro,
        isAuto
      })
    : { mustGate: !!isAuto, gateOk: false, macdPts: 0, smaPts: 0, macroPts: 0 };

  const gateOk = direction ? macdGate({ direction, hist: mc.hist }) : false;
  const fin = direction ? finalScore(base, { ...pro, macroPts: macro.MACRO_PTS }) : { total: 0, label: "NO SIGNAL" };

  return {
    ok: true,
    tf,
    candles,
    last,
    close,
    i,
    direction,
    ema: { e21, e55, e200 },
    ind: { r14, r14Prev, atr14, adx14, atrPct, distAtr, pullbackMaxAtr: pbMax, sma20: sm[i] },
    macd: { ...mc, gateOk, histNow: mc.hist[i], histPrev: mc.hist[i - 1] },
    macro,
    base,
    pro,
    fin,
    ctaGate,
    ichimoku,
    pullbackOk
  };
}

function _bool(v, def = false) {
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  if (v === false || v === "false" || v === 0 || v === "0") return false;
  return def;
}

function _num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function _isLtf(tf) {
  const t = String(tf || "").toLowerCase();
  return t === "15m" || t === "30m" || t === "1h";
}

function htfPermissionGate({ symbol, tf, klines, thresholds, env = {}, isAuto }) {
  // HARD GATE: HTF (default 4H) is the permission layer for LTF signals.
  const enabled = _bool(env?.HTF_HARD_GATE_ENABLED ?? thresholds?.HTF_HARD_GATE_ENABLED ?? HTF_HARD_GATE_ENABLED, true);
  if (!enabled) return { ok: true };

  if (!_isLtf(tf)) return { ok: true };

  const htfTf = String(env?.SECONDARY_TIMEFRAME || "4h").toLowerCase();
  const entryTf = String(tf || "").toLowerCase();
  if (entryTf === htfTf) return { ok: true };

  const htf = computeCore({ symbol, tf: htfTf, klines, thresholds, env, isAuto });
  if (!htf.ok) return { ok: false, reason: "HTF_NOT_READY" };

  // If HTF CTA is enabled, certain reasons become HARD blocks for LTF.
  const blockReclaim = _bool(
    env?.HTF_BLOCK_ON_RECLAIM_NOT_CONFIRMED ?? thresholds?.HTF_BLOCK_ON_RECLAIM_NOT_CONFIRMED ?? HTF_BLOCK_ON_RECLAIM_NOT_CONFIRMED,
    true
  );

  if (htf.ctaGate?.enabled && !htf.ctaGate.ok) {
    if (htf.ctaGate.hardBlock) return { ok: false, reason: `HTF_${htf.ctaGate.reason || "CTA_BLOCK"}` };
    if (blockReclaim && String(htf.ctaGate.reason || "") === "RECLAIM_NOT_CONFIRMED") {
      return { ok: false, reason: "HTF_RECLAIM_NOT_CONFIRMED" };
    }
  }

  // HTF distance-to-EMA21 (ATR units) hard gate.
  const maxDist = _num(env?.HTF_MAX_EMA21_DIST_ATR ?? thresholds?.HTF_MAX_EMA21_DIST_ATR ?? HTF_MAX_EMA21_DIST_ATR, 0.75);
  if (Number.isFinite(maxDist)) {
    const d = Number(htf?.ind?.distAtr);
    if (Number.isFinite(d) && d > maxDist) return { ok: false, reason: "HTF_TOO_FAR_FROM_EMA21" };
  }

  return { ok: true, htf };
}

function chopGate(core, thresholds, env = {}) {
  const enabled = _bool(env?.CHOP_FILTER_ENABLED ?? thresholds?.CHOP_FILTER_ENABLED ?? CHOP_FILTER_ENABLED, true);
  if (!enabled) return { ok: true };

  if (!_isLtf(core?.tf)) return { ok: true };

  const minAdx = _num(env?.CHOP_MIN_ADX ?? thresholds?.CHOP_MIN_ADX ?? CHOP_MIN_ADX, 18);
  const minAtrPct = _num(env?.CHOP_MIN_ATR_PCT ?? thresholds?.CHOP_MIN_ATR_PCT ?? CHOP_MIN_ATR_PCT, 0.0035);
  const minEmaSep = _num(env?.CHOP_MIN_EMA_SEP_ATR ?? thresholds?.CHOP_MIN_EMA_SEP_ATR ?? CHOP_MIN_EMA_SEP_ATR, 0.25);

  const adx14 = Number(core?.ind?.adx14);
  const atrPct = Number(core?.ind?.atrPct);
  const atr14 = Number(core?.ind?.atr14) || 0;
  const e21 = Number(core?.ema?.e21);
  const e55 = Number(core?.ema?.e55);

  const emaSepAtr =
    (Number.isFinite(e21) && Number.isFinite(e55) && atr14 > 0)
      ? (Math.abs(e21 - e55) / atr14)
      : null;

  if (Number.isFinite(minAdx) && Number.isFinite(adx14) && adx14 < minAdx) return { ok: false, reason: "CHOP_ADX_LOW" };
  if (Number.isFinite(minAtrPct) && Number.isFinite(atrPct) && atrPct < minAtrPct) return { ok: false, reason: "CHOP_ATR_LOW" };
  if (Number.isFinite(minEmaSep) && emaSepAtr != null && emaSepAtr < minEmaSep) return { ok: false, reason: "CHOP_EMA_SEP_LOW" };

  return { ok: true, emaSepAtr };
}

function triggerGate(core, thresholds, env = {}) {
  const enabled = _bool(env?.TRIGGER_CONFIRM_ENABLED ?? thresholds?.TRIGGER_CONFIRM_ENABLED ?? TRIGGER_CONFIRM_ENABLED, true);
  if (!enabled) return { ok: true };

  if (!_isLtf(core?.tf)) return { ok: true };

  const needCloseReclaim = _bool(
    env?.TRIGGER_REQUIRE_CLOSE_RECLAIM_EMA21 ?? thresholds?.TRIGGER_REQUIRE_CLOSE_RECLAIM_EMA21 ?? TRIGGER_REQUIRE_CLOSE_RECLAIM_EMA21,
    true
  );
  const needRsiTurn = _bool(
    env?.TRIGGER_REQUIRE_RSI_TURN ?? thresholds?.TRIGGER_REQUIRE_RSI_TURN ?? TRIGGER_REQUIRE_RSI_TURN,
    true
  );
  const needMacdTurn = _bool(
    env?.TRIGGER_REQUIRE_MACD_HIST_TURN ?? thresholds?.TRIGGER_REQUIRE_MACD_HIST_TURN ?? TRIGGER_REQUIRE_MACD_HIST_TURN,
    false
  );

  const close = Number(core?.close);
  const e21 = Number(core?.ema?.e21);
  const rNow = Number(core?.ind?.r14);
  const rPrev = Number(core?.ind?.r14Prev);
  const hNow = core?.macd?.histNow;
  const hPrev = core?.macd?.histPrev;

  if (!Number.isFinite(close) || !Number.isFinite(e21) || !core?.direction) return { ok: false, reason: "TRIGGER_NOT_READY" };

  const long = core.direction === "LONG";
  const closeReclaimOk = !needCloseReclaim ? true : (long ? (close > e21) : (close < e21));

  const rsiTurnOk = !needRsiTurn
    ? true
    : (Number.isFinite(rPrev) && Number.isFinite(rNow)
        ? (long ? (rNow > rPrev) : (rNow < rPrev))
        : false);

  const macdTurnOk = !needMacdTurn
    ? true
    : (hPrev != null && hNow != null
        ? (long ? (hNow >= hPrev) : (hNow <= hPrev))
        : false);

  if (!closeReclaimOk) return { ok: false, reason: "TRIGGER_CLOSE_NOT_CONFIRMED" };
  if (!rsiTurnOk) return { ok: false, reason: "TRIGGER_RSI_NOT_TURNING" };
  if (!macdTurnOk) return { ok: false, reason: "TRIGGER_MACD_NOT_TURNING" };

  return { ok: true };
}


export function evaluateSignal({ symbol, tf, klines, thresholds, env = {}, isAuto }) {
  const core = computeCore({ symbol, tf, klines, thresholds, env, isAuto });
  if (!core.ok) return { ok: false };

  // HTF permission layer (HARD GATE): LTF must not publish when HTF rejects.
  const htfPerm = htfPermissionGate({ symbol, tf, klines, thresholds, env, isAuto });
  if (!htfPerm.ok) return { ok: false };

  // Direction lock: if HTF has a clear direction, LTF must not contradict it.
  if (htfPerm.htf?.direction && core.direction && htfPerm.htf.direction !== core.direction) return { ok: false };

  const softMinAuto = Number(env?.CTA_SOFT_MIN_SCORE_AUTO ?? thresholds?.CTA_SOFT_MIN_SCORE_AUTO ?? thresholds?.AUTO_MIN_SCORE ?? 85);
  const softMinScan = Number(env?.CTA_SOFT_MIN_SCORE_SCAN ?? thresholds?.CTA_SOFT_MIN_SCORE_SCAN ?? 75);
  const softMinScore = isAuto ? softMinAuto : softMinScan;

  // CTA: if enabled and failed:
  // - hardBlock reasons => always block
  // - softFail reasons => allow only if score is already strong (keeps precision while avoiding "0 signal" days)
  if (core.ctaGate?.enabled && !core.ctaGate.ok) {
    // On LTF, RECLAIM_NOT_CONFIRMED is treated as a HARD block (prevents early fakeouts).
    if (_isLtf(tf) && String(core.ctaGate.reason || "") === "RECLAIM_NOT_CONFIRMED") return { ok: false };

    if (core.ctaGate.hardBlock) return { ok: false };
    if (Number(core.fin.total || 0) < softMinScore) return { ok: false };
  }

  // CTA: direction lock mismatch => always block
  if (
    core.ctaGate?.enabled &&
    core.ctaGate.direction &&
    core.direction &&
    core.direction !== core.ctaGate.direction
  ) return { ok: false };

  // Ichimoku compass (LOCKED):
  // - Direction mismatch => block
  // - AUTO rejects NEUTRAL/UNKNOWN
  if (core.ichimoku?.bias === "BULL" && core.direction && core.direction !== "LONG") return { ok: false };
  if (core.ichimoku?.bias === "BEAR" && core.direction && core.direction !== "SHORT") return { ok: false };
  if (isAuto && (core.ichimoku?.bias === "NEUTRAL" || core.ichimoku?.bias === "UNKNOWN")) return { ok: false };

  if (!core.direction) return { ok: false };

  // Chop / range hard filter (prevents high scores in sideways markets).
  const chop = chopGate(core, thresholds, env);
  if (!chop.ok) return { ok: false };

  if (!core.pullbackOk) return { ok: false };
  if (core.fin.total < 70) return { ok: false };

  // AUTO publish gate: MACD must confirm direction
  if (isAuto && !core.macd.gateOk) return { ok: false };

  // 2-step confirmation: Setup -> Trigger
  const trig = triggerGate(core, thresholds, env);
  if (!trig.ok) return { ok: false };

  const entryMid = core.close;

  const playbook = playbookForTf(tf, env);
  const tpRMults = playbook === "SWING" ? [1.0, 1.5, 2.0] : [1.0, 1.4, 1.8];

  const lv = levelsFromATR({
    direction: core.direction,
    entryMid,
    atrVal: core.ind.atr14,
    zoneMult: thresholds.ZONE_ATR_MULT,
    slMult: thresholds.SL_ATR_MULT,
    tpRMults
  });

  const scoreRaw = Number(core.fin.total || 0);
  let ichimokuPts = 0;

  if (!isAuto) {
    if (core.ichimoku?.bias === "BULL" || core.ichimoku?.bias === "BEAR") ichimokuPts = 4;
    else if (core.ichimoku?.bias === "NEUTRAL" || core.ichimoku?.bias === "UNKNOWN") ichimokuPts = -12;
  }

  const score = clampNum(scoreRaw + ichimokuPts, 0, 100);
  const scoreLabel = scoreLabelFromScore(score);

  const points = {
    EMA: core.base.parts.EMA,
    Pullback: core.base.parts.PULLBACK,
    RSI: core.base.parts.RSI,
    ADX: core.base.parts.ADX,
    Risk: core.base.parts.RISK,
    MACD: core.pro.macdPts,
    SMA: core.pro.smaPts,
    Macro: core.macro.MACRO_PTS,
    Ichimoku: ichimokuPts
  };

  return {
    ok: true,
    tf,
    symbol,
    playbook,
    r: lv.R,

        direction: core.direction,
    candleCloseTime: core.last.closeTime,
    score,
    scoreRaw,
    scoreLabel,
    ichimoku: core.ichimoku,
    macro: { BTC_STATE: core.macro.BTC_STATE, ALT_STATE: core.macro.ALT_STATE, BIAS: core.macro.BIAS },
    points,
    levels: {
      entryLow: lv.entryLow,
      entryHigh: lv.entryHigh,
      entryMid: lv.entryMid,
      sl: lv.sl,
      tp1: lv.tp1,
      tp2: lv.tp2,
      tp3: lv.tp3
    },
    candles: core.candles
  };
}

export function explainSignal({ symbol, tf, klines, thresholds, env = {}, isAuto, secondaryMinScore }) {
  const core = computeCore({ symbol, tf, klines, thresholds, env, isAuto });

  if (!core.ok) {
    return {
      symbol,
      tf,
      ok: false,
      score: 0,
      scoreLabel: "NO SIGNAL",
      direction: null,
      blocked: false,
      blockReason: null,
      issues: [
        core.reason === "INSUFFICIENT_DATA"
          ? `Insufficient data (have ${core.metrics.have}, need ${core.metrics.need}+ candles).`
          : "Indicators not ready yet."
      ],
      metrics: core.metrics || {}
    };
  }

  const softMinAuto = Number(env?.CTA_SOFT_MIN_SCORE_AUTO ?? thresholds?.CTA_SOFT_MIN_SCORE_AUTO ?? thresholds?.AUTO_MIN_SCORE ?? 85);
  const softMinScan = Number(env?.CTA_SOFT_MIN_SCORE_SCAN ?? thresholds?.CTA_SOFT_MIN_SCORE_SCAN ?? 75);
  const softMinScore = isAuto ? softMinAuto : softMinScan;

  const issues = [];

  const scoreRaw = Number(core.fin.total || 0);
  let ichimokuPts = 0;

  if (!isAuto) {
    if (core.ichimoku?.bias === "BULL" || core.ichimoku?.bias === "BEAR") ichimokuPts = 4;
    else if (core.ichimoku?.bias === "NEUTRAL" || core.ichimoku?.bias === "UNKNOWN") ichimokuPts = -12;
  }

  const score = Math.round(clampNum(scoreRaw + ichimokuPts, 0, 100));
  const scoreLabel = scoreLabelFromScore(score);

  const ichiBias = core.ichimoku?.bias || "UNKNOWN";
  const ichiOk =
    (ichiBias === "BULL" && core.direction === "LONG") ||
    (ichiBias === "BEAR" && core.direction === "SHORT") ||
    (!isAuto && (ichiBias === "NEUTRAL" || ichiBias === "UNKNOWN"));

  const ctaOk =
    !core.ctaGate?.enabled ||
    (
      // strict pass
      (!!core.ctaGate.ok) ||
      // soft fail allowed if score is already strong
      (!core.ctaGate.ok && !core.ctaGate.hardBlock && Number(core.fin.total || 0) >= softMinScore)
    ) &&
    (!core.ctaGate?.direction || core.direction === core.ctaGate.direction);

  const isValidSetup =
    !!core.direction &&
    !!core.pullbackOk &&
    Number(core.fin.total || 0) >= 70 &&
    ctaOk &&
    ichiOk &&
    (!isAuto || core.macd.gateOk);

  // secondary blocked rule
  const secondaryBlocked =
    secondaryMinScore != null &&
    isValidSetup &&
    Number(score || 0) < Number(secondaryMinScore);

  // Additional hard gates (reported as BLOCKED so /scan can show WATCHLIST-style output).
  const htfPerm = htfPermissionGate({ symbol, tf, klines, thresholds, env, isAuto });
  const htfBlocked = isValidSetup && !htfPerm.ok;

  const htfDirMismatch =
    isValidSetup &&
    !!htfPerm?.htf?.direction &&
    !!core.direction &&
    String(htfPerm.htf.direction) !== String(core.direction);

  const chop = chopGate(core, thresholds, env);
  const chopBlocked = isValidSetup && !chop.ok;

  const trig = triggerGate(core, thresholds, env);
  const trigBlocked = isValidSetup && !trig.ok;

  const blocked = !!(htfBlocked || htfDirMismatch || chopBlocked || trigBlocked || secondaryBlocked);

  const blockReason = blocked
    ? (
        htfBlocked ? (htfPerm.reason || "HTF gate") :
        htfDirMismatch ? "HTF direction mismatch" :
        chopBlocked ? (chop.reason || "Chop filter") :
        trigBlocked ? (trig.reason || "Trigger not confirmed") :
        `Secondary filter (score < ${secondaryMinScore})`
      )
    : null;

  if (htfBlocked) issues.push(`HTF gate blocked on ${String(env?.SECONDARY_TIMEFRAME || "4h")}: ${htfPerm.reason || "REJECTED"}.`);
  if (htfDirMismatch) issues.push(`HTF direction mismatch: HTF=${htfPerm.htf?.direction} vs LTF=${core.direction}.`);
  if (chopBlocked) issues.push(`Chop filter blocked: ${chop.reason || "SIDEWAYS"}.`);
  if (trigBlocked) issues.push(`Trigger not confirmed: ${trig.reason || "WAIT"}.`);

  if (!core.direction) {
    issues.push("No clear trend (EMA55 is not decisively above/below EMA200).");
  } else {
    // Ichimoku compass notes (LOCKED)
    if (ichiBias === "UNKNOWN") {
      issues.push(`Ichimoku compass not ready on ${core.ichimoku?.tf || (env?.SECONDARY_TIMEFRAME || "4h")} (${isAuto ? "AUTO blocked" : "score penalized"}).`);
    } else if (ichiBias === "NEUTRAL") {
      issues.push(`Ichimoku compass is NEUTRAL on ${core.ichimoku?.tf || (env?.SECONDARY_TIMEFRAME || "4h")} (${isAuto ? "AUTO blocked" : "score penalized"}).`);
    } else if (ichiBias === "BULL" && core.direction && core.direction !== "LONG") {
      issues.push(`Ichimoku bias is BULL (4H) but local direction is ${core.direction}.`);
    } else if (ichiBias === "BEAR" && core.direction && core.direction !== "SHORT") {
      issues.push(`Ichimoku bias is BEAR (4H) but local direction is ${core.direction}.`);
    }

    if (!ichiOk) {
      if (isAuto && (ichiBias === "NEUTRAL" || ichiBias === "UNKNOWN")) {
        issues.push("AUTO blocked by Ichimoku: bias must be BULL/BEAR (not NEUTRAL/UNKNOWN).");
      } else if (core.direction) {
        issues.push("Blocked by Ichimoku direction lock.");
      }
    }

    if (core.ctaGate?.enabled) {
      if (!core.ctaGate.ok) {
        const r = core.ctaGate.reason || "CTA gate failed";
        const reg = core.ctaGate.regime ? `Regime=${core.ctaGate.regime}` : "";
        const st = core.ctaGate.setup?.setup ? `Setup=${core.ctaGate.setup.setup}` : "";
        const rec = core.ctaGate.reclaim?.ok != null ? `Reclaim=${core.ctaGate.reclaim.ok ? "CONFIRMED" : "NO"}` : "";

        if (core.ctaGate.hardBlock) {
          issues.push(`CTA PRO Trend filter blocked: ${r}. ${[reg, st, rec].filter(Boolean).join(" ")}`);
        } else {
          issues.push(`CTA soft gate: ${r}. Allowed if score >= ${softMinScore}. ${[reg, st, rec].filter(Boolean).join(" ")}`);
        }
      }

      if (core.ctaGate.direction && core.direction && core.direction !== core.ctaGate.direction) {
        issues.push(`CTA direction lock mismatch: expected ${core.ctaGate.direction}, but local direction is ${core.direction}.`);
      }
    }

    if (!core.pullbackOk) {
      issues.push(`Pullback too far from EMA21 (distance ${core.ind.distAtr.toFixed(2)} ATR; need <= ${Number(core.ind.pullbackMaxAtr).toFixed(2)} ATR).`);
    }
    if (core.ind.adx14 < thresholds.ADX_MIN) {
      issues.push(`ADX too low (${core.ind.adx14.toFixed(1)} < ${thresholds.ADX_MIN}).`);
    }
    const atrPctMin = thresholds.ATR_PCT_MIN * 100;
    const atrPctVal = core.ind.atrPct * 100;
    if (core.ind.atrPct < thresholds.ATR_PCT_MIN) {
      issues.push(`ATR% too low (${atrPctVal.toFixed(2)}% < ${atrPctMin.toFixed(2)}%).`);
    }
    if (core.direction === "LONG" && core.ind.r14 < thresholds.RSI_BULL_MIN) {
      issues.push(`RSI too weak for LONG (${core.ind.r14.toFixed(1)} < ${thresholds.RSI_BULL_MIN}).`);
    }
    if (core.direction === "SHORT" && core.ind.r14 > thresholds.RSI_BEAR_MAX) {
      issues.push(`RSI too strong for SHORT (${core.ind.r14.toFixed(1)} > ${thresholds.RSI_BEAR_MAX}).`);
    }
    if (core.fin.total < 70) {
      issues.push(`Score below 70 (${Math.round(core.fin.total)}).`);
    }
  }

  // AUTO-only info
  if (isAuto && core.direction && !core.macd.gateOk) {
    issues.push("MACD gate failed (AUTO-only publish gate).");
  }

  // BLOCKED info
  if (blocked) {
    issues.unshift(`Valid setup but BLOCKED: ${blockReason}.`);
  }

  if (!issues.length && isValidSetup) {
    issues.push("Valid setup.");
  }

  return {
    symbol,
    tf,
    ok: isValidSetup,
    score,
    scoreRaw,
    scoreLabel,
    direction: core.direction,
    blocked,
    blockReason,
    issues,
    metrics: {
      close: core.close,
      ema21: core.ema.e21,
      ema55: core.ema.e55,
      ema200: core.ema.e200,
      rsi14: core.ind.r14,
      adx14: core.ind.adx14,
      atrPct: core.ind.atrPct,
      distAtr: core.ind.distAtr,
      macdHist: core.macd.hist,
      ichimokuTf: core.ichimoku?.tf,
      ichimokuBias: core.ichimoku?.bias,
      ichimokuTk: core.ichimoku?.tk,
      ichimokuCloudDistPct: core.ichimoku?.distanceToCloudPct
    }
  };
}