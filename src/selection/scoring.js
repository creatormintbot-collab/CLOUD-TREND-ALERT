import { ema } from "../indicators/ema.js";
import { macdHistogram } from "../indicators/macd.js";
import { sma } from "../indicators/sma.js";
import { detectFVG, scoreFVG } from "./fvg.js";
import { scoreMacro } from "./macro.js";

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function computeScore({ candles, indicators, direction, macroBias }) {
  const closes = candles.map((c) => c.close);
  const vols = candles.map((c) => c.volume);
  const last = candles[candles.length - 1];

  // Base components (LOCKED ranges)
  // Trend EMA strength: 0-30
  // RSI momentum: 0-25
  // ADX: 0-25
  // ATR%: 0-10
  // Pullback quality: 0-10

  const { ema21, ema55, ema200, rsi14, adx14, atrPct } = indicators;

  const emaStrengthRaw = Math.abs((ema55 - ema200) / ema200) * 100;
  const trendScore = clamp(emaStrengthRaw * 6, 0, 30); // 5% => 30

  const rsiScore =
    direction === "LONG"
      ? clamp((rsi14 - 50) * 3.125, 0, 25) // 58 => 25
      : clamp((50 - rsi14) * 3.125, 0, 25);

  const adxScore = clamp((adx14 - 10) * 1.5, 0, 25); // 26.6 => ~25
  const atrScore = clamp((atrPct - 0.2) * 50, 0, 10); // 0.4 => 10

  // Pullback quality (how close low/high touched EMA21)
  let pullbackScore = 0;
  if (direction === "LONG") {
    const dist = Math.abs((last.low - ema21) / ema21) * 100;
    pullbackScore = clamp(10 - dist * 20, 0, 10); // closer => higher
  } else {
    const dist = Math.abs((last.high - ema21) / ema21) * 100;
    pullbackScore = clamp(10 - dist * 20, 0, 10);
  }

  // Bonus layers
  // FVG +0..18
  const fvg = detectFVG(candles, direction);
  const fvgSc = scoreFVG({ fvg, price: last.close });

  // MACD histogram (12,26,9): aligned +10, strengthening +5
  const macd = macdHistogram(closes);
  let macdScore = 0;
  let macdAligned = false;
  let macdStrength = false;
  if (macd) {
    macdAligned = direction === "LONG" ? macd.hist > 0 : macd.hist < 0;
    if (macdAligned) macdScore += 10;
    macdStrength =
      direction === "LONG"
        ? macd.hist > macd.prevHist && macd.prevHist > macd.prev2Hist
        : macd.hist < macd.prevHist && macd.prevHist < macd.prev2Hist;
    if (macdStrength) macdScore += 5;
  }

  // Volume ratio: vol / SMA20(vol)
  const volSma20 = sma(vols, 20);
  let volScore = 0;
  let volRatio = null;
  if (volSma20) {
    volRatio = last.volume / volSma20;
    if (volRatio >= 1.2) volScore = 10;
    else if (volRatio >= 1.0) volScore = 5;
  }

  const macroScore = scoreMacro({ bias: macroBias, direction });

  const total =
    trendScore +
    rsiScore +
    adxScore +
    atrScore +
    pullbackScore +
    fvgSc.score +
    macdScore +
    volScore +
    macroScore;

  const finalScore = clamp(total, 0, 100);

  return {
    finalScore,
    breakdown: {
      trendScore: Math.round(trendScore),
      rsiScore: Math.round(rsiScore),
      adxScore: Math.round(adxScore),
      atrScore: Math.round(atrScore),
      pullbackScore: Math.round(pullbackScore),
      fvgScore: fvgSc.score,
      macdScore,
      volScore,
      macroScore
    },
    meta: {
      fvgTag: fvgSc.tag,
      macdAligned,
      macdStrength,
      volRatio: volRatio ? Number(volRatio.toFixed(2)) : null
    }
  };
}
