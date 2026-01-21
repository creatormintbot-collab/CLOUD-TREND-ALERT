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

function levelsFromATR({ direction, entryMid, atrVal, zoneMult, slMult }) {
  const zoneSize = atrVal * zoneMult;
  const entryLow = entryMid - zoneSize;
  const entryHigh = entryMid + zoneSize;

  const slDist = atrVal * slMult;
  const sl = direction === "LONG" ? entryMid - slDist : entryMid + slDist;

  const tp1 = direction === "LONG" ? entryMid + slDist * 1.2 : entryMid - slDist * 1.2;
  const tp2 = direction === "LONG" ? entryMid + slDist * 2.0 : entryMid - slDist * 2.0;
  const tp3 = direction === "LONG" ? entryMid + slDist * 3.0 : entryMid - slDist * 3.0;

  return { entryLow, entryHigh, entryMid, sl, tp1, tp2, tp3, slDist };
}

function pickTrendTf(entryTf, thresholds, env) {
  // Precedence: explicit override (thresholds/env) > derived mapping by entry TF > default "4h"
  const explicit = String(thresholds?.TREND_TF || env?.TREND_TF || "").trim();
  if (explicit) return explicit;

  const tf = String(entryTf || "").toLowerCase();
  if (tf === "15m") return "1h";
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
  const pullbackOk = distAtr <= 0.6;

  // CTA PRO TREND (optional) - HTF regime gate + direction lock (block mismatched direction)
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
    candles,
    last,
    close,
    i,
    direction,
    ema: { e21, e55, e200 },
    ind: { r14, atr14, adx14, atrPct, distAtr, sma20: sm[i] },
    macd: { ...mc, gateOk },
    macro,
    base,
    pro,
    fin,
    ctaGate,
    pullbackOk
  };
}

export function evaluateSignal({ symbol, tf, klines, thresholds, env = {}, isAuto }) {
  const core = computeCore({ symbol, tf, klines, thresholds, env, isAuto });
  if (!core.ok) return { ok: false };

  // CTA: block if enabled but failed
  if (core.ctaGate?.enabled && !core.ctaGate.ok) return { ok: false };

  // CTA: direction lock mismatch => block (safer than overriding mature scoring engine)
  if (
    core.ctaGate?.enabled &&
    core.ctaGate.ok &&
    core.ctaGate.direction &&
    core.direction &&
    core.direction !== core.ctaGate.direction
  ) return { ok: false };

  if (!core.direction) return { ok: false };
  if (!core.pullbackOk) return { ok: false };
  if (core.fin.total < 70) return { ok: false };

  const entryMid = core.close;
  const lv = levelsFromATR({
    direction: core.direction,
    entryMid,
    atrVal: core.ind.atr14,
    zoneMult: thresholds.ZONE_ATR_MULT,
    slMult: thresholds.SL_ATR_MULT
  });

  const points = {
    EMA: core.base.parts.EMA,
    Pullback: core.base.parts.PULLBACK,
    RSI: core.base.parts.RSI,
    ADX: core.base.parts.ADX,
    Risk: core.base.parts.RISK,
    MACD: core.pro.macdPts,
    SMA: core.pro.smaPts,
    Macro: core.macro.MACRO_PTS
  };

  return {
    ok: true,
    symbol,
    tf,
    direction: core.direction,
    candleCloseTime: core.last.closeTime,
    score: core.fin.total,
    scoreLabel: core.fin.label,
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

  const issues = [];

  const isValidSetup =
    !!core.direction &&
    !!core.pullbackOk &&
    Number(core.fin.total || 0) >= 70 &&
    (!core.ctaGate?.enabled || (
      !!core.ctaGate.ok &&
      (!core.ctaGate.direction || core.direction === core.ctaGate.direction)
    ));

  // secondary blocked rule
  const secondaryBlocked =
    secondaryMinScore != null &&
    isValidSetup &&
    Number(core.fin.total || 0) < Number(secondaryMinScore);

  const blocked = !!secondaryBlocked;
  const blockReason = blocked ? `Secondary filter (score < ${secondaryMinScore})` : null;

  if (!core.direction) {
    issues.push("No clear trend (EMA55 is not decisively above/below EMA200).");
  } else {
    if (core.ctaGate?.enabled) {
      if (!core.ctaGate.ok) {
        const r = core.ctaGate.reason || "CTA gate failed";
        const reg = core.ctaGate.regime ? `Regime=${core.ctaGate.regime}` : "";
        const st = core.ctaGate.setup?.setup ? `Setup=${core.ctaGate.setup.setup}` : "";
        const rec = core.ctaGate.reclaim?.ok != null ? `Reclaim=${core.ctaGate.reclaim.ok ? "CONFIRMED" : "NO"}` : "";
        issues.push(`CTA PRO Trend filter blocked: ${r}. ${[reg, st, rec].filter(Boolean).join(" ")}`);
      } else if (core.ctaGate.direction && core.direction && core.direction !== core.ctaGate.direction) {
        issues.push(`CTA direction lock mismatch: expected ${core.ctaGate.direction}, but local trend is ${core.direction}.`);
      }
    }

    if (!core.pullbackOk) {
      issues.push(`Pullback too far from EMA21 (distance ${core.ind.distAtr.toFixed(2)} ATR; need <= 0.60 ATR).`);
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
    score: Math.round(core.fin.total || 0),
    scoreLabel: core.fin.label,
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
      macdHist: core.macd.hist
    }
  };
}
