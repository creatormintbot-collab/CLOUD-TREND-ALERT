import { clamp } from "../../utils/math.js";

export function scoreLabel(score) {
  if (score >= 90) return "ELITE";
  if (score >= 80) return "STRONG";
  if (score >= 70) return "OK";
  return "NO SIGNAL";
}

export function finalScore(base, pro) {
  const total = clamp(base.total + pro.macdPts + pro.smaPts + pro.macroPts, 0, 100);
  return { total, label: scoreLabel(total) };
}
