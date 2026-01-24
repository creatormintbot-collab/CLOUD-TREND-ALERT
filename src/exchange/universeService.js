export class UniverseService {
  constructor({
    rest,
    volumeMarket = "USDT",
    topN = 50,

    // Backward compatible: if true, UniverseService.symbols() returns Top-N by volume.
    // If false, UniverseService.symbols() returns the scan universe (ALL perps filtered by liquidity floor).
    useTopVolume = true,

    // Liquidity floor (applies to scan + auto universes). 0 = disabled (backward compatible).
    liquidityMinQuoteVol = 0,

    // AUTO volume gate (applies after liquidity floor). If both are 0, no extra AUTO gate is applied.
    // Note: gate is OR logic: (rank <= autoVolumeTopN) OR (quoteVolume >= autoMinQuoteVol).
    autoVolumeTopN = 0,
    autoMinQuoteVol = 0,

    logger
  } = {}) {
    this.rest = rest;
    this.volumeMarket = String(volumeMarket || "USDT").toUpperCase();
    this.topN = Number(topN || 50);
    this.useTopVolume = useTopVolume === undefined ? true : Boolean(useTopVolume);

    this.liquidityMinQuoteVol = Number(liquidityMinQuoteVol || 0);
    this.autoVolumeTopN = Number(autoVolumeTopN || 0);
    this.autoMinQuoteVol = Number(autoMinQuoteVol || 0);

    this.logger = logger || console;

    // Backward compatible default universe list (used by existing jobs)
    this._symbols = [];

    // Additional universes for pipeline separation (scan vs auto)
    this._scanSymbols = [];
    this._autoSymbols = [];
    this._topSymbols = [];

    // New: keep full rows for /top volume UI (cached)
    this._topRows = [];

    this._perpSet = new Set();
  }

  // Backward compatible getter. See "useTopVolume" config.
  symbols() { return this._symbols.slice(); }

  // Preferred getters for new pipeline (scan vs auto).
  symbolsForScan() { return (this._scanSymbols && this._scanSymbols.length ? this._scanSymbols : this._symbols).slice(); }
  symbolsForAuto() { return (this._autoSymbols && this._autoSymbols.length ? this._autoSymbols : this._symbols).slice(); }
  topSymbols() { return (this._topSymbols && this._topSymbols.length ? this._topSymbols : this._symbols).slice(); }

  // New: top volume rows (symbol + quoteVolume) for /top card.
  topVolumeRows(n = 10) {
    const lim = Math.max(0, Math.floor(Number(n || 10)));
    return (this._topRows && this._topRows.length ? this._topRows : []).slice(0, lim);
  }

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
    const tickers0 = await this.rest.ticker24h();
    const tickers = Array.isArray(tickers0) ? tickers0 : (tickers0 ? [tickers0] : []);
    const rows = (tickers || [])
      .map((t) => ({
        symbol: String(t.symbol || "").toUpperCase(),
        quoteVolume: Number(t.quoteVolume || 0)
      }))
      .filter((r) => r.symbol && this._perpSet.has(r.symbol))
      .sort((a, b) => b.quoteVolume - a.quoteVolume);

    // Top-N universe (legacy behaviour)
    this._topRows = rows.slice(0, this.topN);
    this._topSymbols = this._topRows.map((r) => r.symbol);

    // Liquidity floor universe (ALL perps filtered by quote volume threshold)
    const minQ = Number(this.liquidityMinQuoteVol || 0);
    const liquidRows = minQ > 0 ? rows.filter((r) => r.quoteVolume >= minQ) : rows;
    this._scanSymbols = liquidRows.map((r) => r.symbol);

    // AUTO volume gate after liquidity floor (OR logic: Top-N OR Min Quote Vol)
    const autoTopN = Math.max(0, Math.floor(Number(this.autoVolumeTopN || 0)));
    const autoMinQ = Math.max(0, Number(this.autoMinQuoteVol || 0));
    const autoRows = liquidRows.filter((r, idx) => {
      // No extra gate -> keep liquidity floor result
      if (autoTopN <= 0 && autoMinQ <= 0) return true;
      if (autoMinQ > 0 && r.quoteVolume >= autoMinQ) return true;
      if (autoTopN > 0 && idx < autoTopN) return true;
      return false;
    });
    this._autoSymbols = autoRows.map((r) => r.symbol);

    // Backward compatible: keep symbols() behaviour intact unless useTopVolume disabled.
    this._symbols = this.useTopVolume ? this._topSymbols.slice() : this._scanSymbols.slice();

    this.logger?.info?.("[universe] refreshed", {
      perps: this._perpSet.size,
      topN: this._topSymbols.length,
      liquid: this._scanSymbols.length,
      auto: this._autoSymbols.length,
      useTopVolume: this.useTopVolume,
      minQuoteVol: minQ,
      autoTopN,
      autoMinQuoteVol: autoMinQ
    });
  }
}