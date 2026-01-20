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

  topRanked() {
    return this.stateRepo.getRankCache();
  }

  /**
   * /scan (no pair) — LOCKED:
   * Batch scan universe → Top50 → Top30 → Top10 → return Top 1–3
   * Each symbol is evaluated on 15m/30m/1h/4h and reduced to ONE best TF.
   * 4h is only eligible when score >= SECONDARY_MIN_SCORE (handled in scanPair).
   *
   * IMPORTANT:
   * - This does NOT replace or refactor existing mature logic.
   * - Rotation-based single-pair scan remains available via scanOneBest (not used by /scan anymore).
   */
  async scanBatchBest({ limit = 3 } = {}) {
    const symbols = this.universe.symbols();
    const baseTfs = Array.isArray(this.env.SCAN_TIMEFRAMES) ? [...this.env.SCAN_TIMEFRAMES] : [];

    // Step 1: fast-rank symbols (cheap) and pick Top50
    const ranked = symbols
      .map((s) => {
        let fast = 0;
        for (const tf of baseTfs) {
          const v = this.ranker.fastScore(s, tf, this.thresholds);
          if (v > fast) fast = v;
        }
        return { symbol: s, fast };
      })
      .sort((a, b) => b.fast - a.fast);

    // If the cache is cold (WS/backfill not ready), fastScore may be 0 for many symbols.
    // Fail-safe: still take a deterministic slice so /scan never becomes "empty" due to missing candles.
    const top50 = (ranked.filter((r) => r.fast > 0).length >= 10 ? ranked.filter((r) => r.fast > 0) : ranked)
      .slice(0, 50)
      .map((r) => r.symbol);

    // Step 2: prefilter Top30 (still cheap)
    const top30 = top50.slice(0, 30);

    // Step 3: deep evaluate Top30 into ONE best TF per symbol
    const evaluated = [];
    for (const sym of top30) {
      const r = await this.scanPair(sym);
      if (r?.ok) evaluated.push(r);
    }

    // Step 4: Top10 (deep) then Top 1–3 output
    evaluated.sort((a, b) => b.score - a.score);
    const top10 = evaluated.slice(0, 10);
    const topOut = top10.slice(0, Math.max(1, Math.min(3, Number(limit || 3))));

    // Cache for /top (best-effort, non-breaking)
    try {
      const rankCache = top10.map((r) => ({ symbol: r.symbol, tf: r.tf, score: r.score }));
      rankCache.sort((a, b) => b.score - a.score);
      this.stateRepo.setRankCache(rankCache.slice(0, 50));
      await this.stateRepo.flush();
    } catch {}

    return {
      kind: "BATCH",
      meta: {
        universe: symbols.length,
        top50: top50.length,
        top30: top30.length,
        top10: top10.length,
        returned: topOut.length
      },
      signals: topOut,
      // Fallback inputs for watchlist/explain if caller wants to show "best effort" when signals are empty.
      candidates: top50
    };
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
    const tfs = [...this.env.SCAN_TIMEFRAMES, this.env.SECONDARY_TIMEFRAME];
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
        if (tf === this.env.SECONDARY_TIMEFRAME && r.score < this.env.SECONDARY_MIN_SCORE) continue;
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
    const tfs = [...this.env.SCAN_TIMEFRAMES, this.env.SECONDARY_TIMEFRAME];
    return tfs.map((tf) =>
      explainSignal({
        symbol,
        tf,
        klines: this.klines,
        thresholds: this.thresholds,
        isAuto: false,
        secondaryMinScore: tf === this.env.SECONDARY_TIMEFRAME ? this.env.SECONDARY_MIN_SCORE : null
      })
    );
  }

  explainPairTf(symbol, tf) {
    return explainSignal({
      symbol,
      tf,
      klines: this.klines,
      thresholds: this.thresholds,
      isAuto: false,
      secondaryMinScore: tf === this.env.SECONDARY_TIMEFRAME ? this.env.SECONDARY_MIN_SCORE : null
    });
  }

  async autoPickCandidates() {
    const symbols = this.universe.symbols();
    const tfs = [...this.env.SCAN_TIMEFRAMES, this.env.SECONDARY_TIMEFRAME];

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
      if (r.tf === this.env.SECONDARY_TIMEFRAME && r.score < this.env.SECONDARY_MIN_SCORE) continue;

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