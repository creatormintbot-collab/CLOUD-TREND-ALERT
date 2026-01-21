import { evaluateSignal, explainSignal } from "../strategy/signalEngine.js";
import { macdGate } from "../strategy/scoring/proScore.js";
import { macd } from "../strategy/indicators/macd.js";

export class Pipeline {
  constructor({ universe, klines, ranker, thresholds, stateRepo, rotationRepo, env }) {
    this.universe = universe;
    this.klines = klines;
    this.ranker = ranker;
    this.thresholds = thresholds;
    this.stateRepo = stateRepo;
    this.rotationRepo = rotationRepo;
    this.env = env;
  }

  _scanTimeframes() {
    const base = Array.isArray(this.env?.SCAN_TIMEFRAMES) ? this.env.SCAN_TIMEFRAMES : [];
    const sec = this.env?.SECONDARY_TIMEFRAME;
    const tfs = [...base];
    if (sec && !tfs.includes(sec)) tfs.push(sec);
    return tfs;
  }

  _autoTimeframes() {
    const base = Array.isArray(this.env?.AUTO_TIMEFRAMES)
      ? this.env.AUTO_TIMEFRAMES
      : (Array.isArray(this.env?.SCAN_TIMEFRAMES) ? this.env.SCAN_TIMEFRAMES : []);
    const sec = this.env?.SECONDARY_TIMEFRAME;
    const tfs = [...base];
    if (sec && !tfs.includes(sec)) tfs.push(sec);
    return tfs;
  }

  _secondaryMinScore(symbol, tf) {
    if (!tf || tf !== this.env?.SECONDARY_TIMEFRAME) return null;
    // LOCKED exception: ETHUSDT is allowed on secondary timeframe even if below SECONDARY_MIN_SCORE
    if (String(symbol || "").toUpperCase() === "ETHUSDT") return null;
    return this.env?.SECONDARY_MIN_SCORE ?? null;
  }


  topRanked() {
    return this.stateRepo.getRankCache();
  }

  async scanOneBest(chatId) {
    const symbols = this.universe.symbols();
    const sym = this.rotationRepo.pickNext(symbols);
    await this.rotationRepo.flush();
    if (!sym) return { symbol: null, res: null };
    const res = await this.scanPair(sym);
    return { symbol: sym, res };
  }

  async scanPair(symbol) {
    const tfs = this._scanTimeframes();
    const results = [];

    for (const tf of tfs) {
      const r = evaluateSignal({
        symbol,
        tf,
        klines: this.klines,
        thresholds: this.thresholds,
        env: this.env,
        isAuto: false
      });
      if (r?.ok) {
        // 4h rule for /scan pair without explicit TF:
        if (tf === this.env.SECONDARY_TIMEFRAME && String(symbol).toUpperCase() !== "ETHUSDT" && r.score < this.env.SECONDARY_MIN_SCORE) continue;
        results.push(r);
      }
    }

    if (!results.length) return null;
    results.sort((a, b) => b.score - a.score);
    return results[0];
  }

  async scanPairTf(symbol, tf) {
    const r = evaluateSignal({
      symbol,
      tf,
      klines: this.klines,
      thresholds: this.thresholds,
      env: this.env,
      isAuto: false
    });
    return r?.ok ? r : null;
  }

  explainPair(symbol) {
    const tfs = this._scanTimeframes();
    return tfs.map((tf) =>
      explainSignal({
        symbol,
        tf,
        klines: this.klines,
        thresholds: this.thresholds,
        env: this.env,
        isAuto: false,
        secondaryMinScore: this._secondaryMinScore(symbol, tf)
      })
    );
  }

  explainPairTf(symbol, tf) {
    return explainSignal({
      symbol,
      tf,
      klines: this.klines,
      thresholds: this.thresholds,
      env: this.env,
      isAuto: false,
      secondaryMinScore: this._secondaryMinScore(symbol, tf)
    });
  }

  async autoPickCandidates() {
    const symbols = this.universe.symbols();
    const tfs = this._autoTimeframes();

    const topUnion = new Map();
    const rankCache = [];

    for (const tf of tfs) {
      const scored = symbols
        .map((s) => ({ symbol: s, tf, fast: this.ranker.fastScore(s, tf, this.thresholds) }))
        .sort((a, b) => b.fast - a.fast)
        .slice(0, this.env.TOP10_PER_TF);

      for (const row of scored) {
        if (row.fast <= 0) continue;
        topUnion.set(`${row.symbol}|${row.tf}`, row);
      }
    }

    const candidates = [];
    for (const row of topUnion.values()) {
      const r = evaluateSignal({
        symbol: row.symbol,
        tf: row.tf,
        klines: this.klines,
        thresholds: this.thresholds,
        env: this.env,
        isAuto: true
      });
      if (!r?.ok) continue;

      // AUTO filters (LOCKED)
      if (r.score < this.env.AUTO_MIN_SCORE) continue;

      // MACD gate must pass for AUTO
      const closes = r.candles.map((c) => Number(c.close));
      const m = macd(closes, 12, 26, 9);
      if (!macdGate({ direction: r.direction, hist: m.hist })) continue;

      // 4h publish rule (LOCKED)
      if (r.tf === this.env.SECONDARY_TIMEFRAME && String(r.symbol).toUpperCase() !== "ETHUSDT" && r.score < this.env.SECONDARY_MIN_SCORE) continue;

      candidates.push(r);
      rankCache.push({ symbol: r.symbol, tf: r.tf, score: r.score });
    }

    rankCache.sort((a, b) => b.score - a.score);
    this.stateRepo.setRankCache(rankCache.slice(0, 50));
    await this.stateRepo.flush();

    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }
}
