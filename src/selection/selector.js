import { clamp } from "../config/constants.js";

export function signalStrengthLabel(score) {
  if (score >= 85) return "HIGH";
  if (score >= 70) return "MEDIUM";
  return "LOW";
}

export function rankCandidates(candidates, topN = 10) {
  return candidates
    .slice()
    .sort((a, b) => (b.score - a.score))
    .slice(0, clamp(topN, 1, 50));
}

export function pickTopToSend(shortlist, maxSend = 3) {
  return shortlist.slice(0, maxSend);
}
