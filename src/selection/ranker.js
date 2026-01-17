export function rankCandidates(candidates, topN) {
  return [...candidates]
    .sort((a, b) => b.score.finalScore - a.score.finalScore)
    .slice(0, topN);
}
