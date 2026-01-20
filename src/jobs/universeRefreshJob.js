export function startUniverseRefreshJob({ hours = 6, run }) {
  const ms = Number(hours) * 3_600_000;
  const t = setInterval(run, ms);
  return { stop: () => clearInterval(t) };
}
