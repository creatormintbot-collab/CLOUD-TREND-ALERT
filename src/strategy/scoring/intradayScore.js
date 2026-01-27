import { clamp } from "../../utils/math.js";
import {
  INTRADAY_MACRO_ADJ,
  INTRADAY_REGIME_ATR_PCT_MIN
} from "../../config/constants.js";

export function intradayScore(ctx = {}) {
  const direction = String(ctx.direction || "").toUpperCase();
  const atrPct1h = Number(ctx.atrPct1h);
  const ema50Slope = Number(ctx.ema50Slope);
  const touches = Number(ctx.srTouches || 0);
  const lastTouchedTs = Number(ctx.srLastTouchedTs || 0);
  const distanceToSr = Number(ctx.distanceToSr);
  const tolerance = Number(ctx.tolerance);
  const timingOk = !!ctx.timingOk;
  const macroBias = String(ctx.macroBias || "").toUpperCase();
  const nowTs = Number(ctx.nowTs || 0);

  const htfAlign = direction ? 25 : 0;

  let regime = 0;
  if (Number.isFinite(atrPct1h)) {
    if (atrPct1h >= INTRADAY_REGIME_ATR_PCT_MIN) regime += 8;
    else if (atrPct1h >= INTRADAY_REGIME_ATR_PCT_MIN * 0.7) regime += 4;
  }
  if (Number.isFinite(ema50Slope)) {
    if (direction === "LONG" && ema50Slope > 0) regime += 7;
    if (direction === "SHORT" && ema50Slope < 0) regime += 7;
  }
  if (regime > 15) regime = 15;

  let srStrength = 0;
  if (touches >= 4) srStrength += 12;
  else if (touches === 3) srStrength += 10;
  else if (touches === 2) srStrength += 8;
  else if (touches === 1) srStrength += 6;

  if (lastTouchedTs > 0 && nowTs > 0) {
    const ageMin = (nowTs - lastTouchedTs) / 60000;
    if (ageMin <= 6 * 60) srStrength += 8;
    else if (ageMin <= 12 * 60) srStrength += 5;
    else if (ageMin <= 24 * 60) srStrength += 2;
  }
  if (srStrength > 20) srStrength = 20;

  let location = 0;
  if (Number.isFinite(distanceToSr) && Number.isFinite(tolerance) && tolerance > 0) {
    const ratio = Math.max(0, Math.min(1, 1 - (distanceToSr / tolerance)));
    location = Math.round(10 * ratio);
  }

  const timing = timingOk ? 10 : 0;

  let macroAdj = 0;
  if (macroBias === "RISK_ON") macroAdj = direction === "LONG" ? INTRADAY_MACRO_ADJ : -INTRADAY_MACRO_ADJ;
  else if (macroBias === "RISK_OFF") macroAdj = direction === "SHORT" ? INTRADAY_MACRO_ADJ : -INTRADAY_MACRO_ADJ;

  const volume = 0;

  const total = clamp(htfAlign + regime + srStrength + location + timing + macroAdj + volume, 0, 100);

  return {
    total,
    macroAdj,
    parts: {
      "HTF Align": htfAlign,
      "Regime": regime,
      "SR Strength": srStrength,
      "Location": location,
      "Timing": timing,
      "Macro adj": macroAdj,
      "Volume": volume
    }
  };
}
