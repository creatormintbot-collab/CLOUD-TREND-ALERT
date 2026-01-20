import { clamp } from "../../utils/math.js";

export function macdGate({ direction, hist }) {
  const n = hist?.length || 0;
  if (n < 3) return false;
  const h0 = hist[n - 1], h1 = hist[n - 2], h2 = hist[n - 3];
  if (h0 == null || h1 == null || h2 == null) return false;

  if (direction === "LONG") return (h0 >= 0) || (h0 > h1 && h1 > h2);
  return (h0 <= 0) || (h0 < h1 && h1 < h2);
}

export function proScore(ctx) {
  const { direction, close, sma20, macdLine, signalLine, hist, macro, isAuto } = ctx;

  let macdPts = 0;
  const gateOk = macdGate({ direction, hist });

  if (gateOk) {
    macdPts += 6;
    const m = macdLine.at(-1), s = signalLine.at(-1);
    if (m != null && s != null) {
      if (direction === "LONG" && m > s) macdPts += 4;
      if (direction === "SHORT" && m < s) macdPts += 4;
    }
  }

  let smaPts = 0;
  if (sma20 != null) {
    if (direction === "LONG" && close >= sma20) smaPts = 5;
    if (direction === "SHORT" && close <= sma20) smaPts = 5;
  }

  // macro bounded -8/0/+8 (applied in finalScore)
  const macroPts = macro?.MACRO_PTS ?? 0;

  // AUTO gate enforced outside (pipeline), but keep flag here
  const mustGate = !!isAuto;

  return { mustGate, gateOk, macdPts: clamp(macdPts, 0, 10), smaPts: clamp(smaPts, 0, 5), macroPts: clamp(macroPts, -8, 8) };
}