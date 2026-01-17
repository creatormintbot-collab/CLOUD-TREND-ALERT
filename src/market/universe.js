export async function buildUniverse({ binance, n, logger }) {
  const syms = await binance.topPerpByVolume(n);
  logger.info({ n: syms.length }, "Universe built (top volume)");
  return syms;
}
