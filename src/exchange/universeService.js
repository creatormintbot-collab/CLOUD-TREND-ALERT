export class UniverseService {
  constructor({ rest, volumeMarket = "USDT", topN = 50, logger } = {}) {
    this.rest = rest;
    this.volumeMarket = String(volumeMarket || "USDT").toUpperCase();
    this.topN = Number(topN || 50);
    this.logger = logger || console;
    this._symbols = [];
    this._perpSet = new Set();
  }

  symbols() { return this._symbols.slice(); }

  async refresh() {
    // build perpetual USDT list from exchangeInfo
    const info = await this.rest.exchangeInfo();
    const allowed = new Set();
    for (const s of (info?.symbols || [])) {
      if (!s) continue;
      const quote = String(s.quoteAsset || "").toUpperCase();
      const contractType = String(s.contractType || "").toUpperCase();
      const status = String(s.status || "").toUpperCase();
      const sym = String(s.symbol || "").toUpperCase();
      if (status !== "TRADING") continue;
      if (quote !== this.volumeMarket) continue;
      if (contractType !== "PERPETUAL") continue;
      allowed.add(sym);
    }
    this._perpSet = allowed;

    // ticker 24h for volume ranking
    const tickers = await this.rest.ticker24h();
    const rows = (tickers || [])
      .map((t) => ({
        symbol: String(t.symbol || "").toUpperCase(),
        quoteVolume: Number(t.quoteVolume || 0)
      }))
      .filter((r) => r.symbol && this._perpSet.has(r.symbol))
      .sort((a, b) => b.quoteVolume - a.quoteVolume);

    this._symbols = rows.slice(0, this.topN).map((r) => r.symbol);

    this.logger?.info?.("[universe] refreshed", { count: this._symbols.length });
  }
}
