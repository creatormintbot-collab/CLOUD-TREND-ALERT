export function startUniverseRefresh({ env, logger, binance, scanner }) {
  const hours = env.UNIVERSE_REFRESH_HOURS;
  const handle = setInterval(async () => {
    try {
      const syms = await binance.topPerpByVolume(env.TOP_VOLUME_N);
      scanner.universe = syms;
      scanner.store.setUniverse(syms);

      // best-effort: re-backfill missing and resubscribe
      await scanner.backfillAllPrimary();
      await scanner.startAutoWs();

      logger.info({ n: syms.length }, "Universe refreshed & resubscribed");
    } catch (e) {
      logger.warn({ err: String(e) }, "Universe refresh failed");
    }
  }, hours * 60 * 60 * 1000);

  return () => clearInterval(handle);
}
