export function computeLevelsLocked({ entryMid, atr14, direction, env }) {
  const zoneSize = atr14 * env.ZONE_ATR_MULT;

  const entryZoneLow = entryMid - zoneSize;
  const entryZoneHigh = entryMid + zoneSize;

  const sldist = atr14 * env.SL_ATR_MULT;

  const sign = direction === "LONG" ? 1 : -1;

  const sl = entryMid - sign * sldist;
  const tp1 = entryMid + sign * sldist * 1.0;
  const tp2 = entryMid + sign * sldist * 1.5;
  const tp3 = entryMid + sign * sldist * 2.0;

  return {
    entryZoneLow,
    entryZoneHigh,
    entryMid,
    sldist,
    sl,
    tp1,
    tp2,
    tp3
  };
}
