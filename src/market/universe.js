import { binanceRest } from "../exchange/rest.js";
import { ENV } from "../config/env.js";

function isPerpUSDT(symbolInfo) {
  return symbolInfo?.contractType === "PERPETUAL" && symbolInfo?.quoteAsset === "USDT" && symbolInfo?.status === "TRADING";
}

export async function buildUniverseTopByVolume(n = 50) {
  const [exInfo, tickers] = await Promise.all([
    binanceRest.exchangeInfo(),
    binanceRest.ticker24h(),
  ]);

  const perpSet = new Set(
    (exInfo.symbols || [])
      .filter(isPerpUSDT)
      .map((s) => s.symbol)
  );

  const rows = (tickers || [])
    .filter((t) => perpSet.has(t.symbol))
    .map((t) => ({
      symbol: t.symbol,
      quoteVolume: Number(t.quoteVolume || 0),
    }))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, n);

  return rows.map((r) => r.symbol);
}

export function createUniverseManager() {
  let universe = [];
  let lastRefresh = 0;

  async function refreshIfNeeded(force = false) {
    const now = Date.now();
    const due = now - lastRefresh >= ENV.UNIVERSE_REFRESH_HOURS * 3600_000;
    if (!force && !due && universe.length) return universe;

    universe = await buildUniverseTopByVolume(ENV.TOP_VOLUME_N);
    lastRefresh = now;
    return universe;
  }

  return {
    get universe() {
      return universe;
    },
    refreshIfNeeded,
  };
}
