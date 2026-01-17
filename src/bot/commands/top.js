export function topText(universe) {
  const list = universe.slice(0, 20).join(", ");
  return `🪙 <b>Top Volume Universe</b>\n${list}${universe.length > 20 ? "…" : ""}`;
}
