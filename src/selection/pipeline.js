import { evaluateSignal, explainSignal } from "../strategy/signalEngine.js";
import { macdGate } from "../strategy/scoring/proScore.js";
import { macd } from "../strategy/indicators/macd.js";


function normTf(tf) {
  return String(tf || "").trim().toLowerCase();
}

function isSwingTf(tf, env) {
  const swing = normTf(env?.SECONDARY_TIMEFRAME || "4h");
  return normTf(tf) === swing;
}

export class Pipeline {
  constructor({ universe, klines, ranker, thresholds, stateRepo, rotationRepo, env }) {
    this.universe = universe;
    this.klines = klines;
    this.ranker = ranker;
    this.thresholds = thresholds;
    this.stateRepo = stateRepo;
    this.rotationRepo = rotationRepo;
    this.env = env;
    this._warmupDone = new Set(); // scan warmup guard (avoid REST spam)
  }

  async _maybeWarmupKlines(symbols, tfs, reason = "scan") {
    try {
      if (!this.klines || typeof this.klines.getCandles !== "function" || typeof this.klines.backfill !== "function") return;

      const minCandles = 220; // must satisfy ranker.fastScore + signalEngine candles requirement
      const maxSyms = Math.max(6, Math.min(12, Number(this.env?.TOP10_PER_TF ?? 10)));

      const symList = Array.from(new Set((symbols || [])
        .map((s) => String(s || "").toUpperCase())
        .filter(Boolean)))
        .slice(0, maxSyms);

      const tfList = Array.from(new Set((tfs || [])
        .map((x) => String(x || "").trim().toLowerCase())
        .filter(Boolean)));

      for (const tf of tfList) {
        const guardKey = `${reason}|${tf}`;
        if (this._warmupDone?.has(guardKey)) continue;

        const need = [];
        for (const s of symList) {
          const n = (this.klines.getCandles(s, tf) || []).length;
          if (n < minCandles) need.push(s);
        }

        // Mark as attempted to avoid repeated backfills if scan is spammed
        this._warmupDone?.add(guardKey);

        if (!need.length) continue;

        // Non-spam: one line per tf per reason
        (this.env?.LOG_LEVEL === "debug" ? console.debug : console.info)(
          `[SCAN] warmup_backfill ${reason} tf=${tf} need=${need.length}/${symList.length} min=${minCandles}`
        );

        await this.klines.backfill(need, [tf]);
      }
    } catch {
      // ignore warmup errors (scan will still run on whatever cache exists)
    }
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

  // /top (LOCKED): Top 10 volume (cached)
  // Returns array of { symbol, quoteVolume } rows when available.
  async topVolumeCached(n = 10) {
    try {
      if (typeof this.universe?.topVolumeRows === "function") return this.universe.topVolumeRows(n);
      if (typeof this.universe?.topSymbols === "function") {
        return this.universe.topSymbols().slice(0, n).map((s) => ({ symbol: s, quoteVolume: 0 }));
      }
      if (typeof this.universe?.symbols === "function") {
        return this.universe.symbols().slice(0, n).map((s) => ({ symbol: s, quoteVolume: 0 }));
      }
    } catch {}
    return [];
  }

  // Backward compatible: ranking cache (still used internally; /top no longer relies on it)
  topRanked() {
    return this.stateRepo.getRankCache();
  }

  async scanOneBest(chatId) {
    const symbols = (this.universe.symbolsForScan?.() || this.universe.symbols?.() || []);
    const sym = this.rotationRepo.pickNext(symbols);
    await this.rotationRepo.flush();
    if (!sym) return { symbol: null, res: null };
    const res = await this.scanPair(sym);
    return { symbol: sym, res };
  }

  async scanPair(symbol) {
    const tfs = this._scanTimeframes();
    const results = [];

    // Warmup klines cache (REST backfill) if intraday candles are missing (prevents /scan from returning swing-only).
    await this._maybeWarmupKlines([symbol], tfs, "scan_pair");


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
    // Warmup klines cache if needed (keeps explain/evaluate consistent after restart).
    await this._maybeWarmupKlines([symbol], [tf], "scan_pair_tf");
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

  // Dual Playbook scan for a single pair (LOCKED):
  // - INTRADAY: best of 15m/30m/1h
  // - SWING: 4h (SECONDARY_TIMEFRAME)
  // Returns { primary, secondary } where primary is preferred (SWING when available).
  async scanPairDual(symbol) {
    const swingTf = String(this.env?.SECONDARY_TIMEFRAME || "4h");
    const all = this._scanTimeframes();

    const intradayTfs = all.filter((t) => !isSwingTf(t, this.env));

    // Warmup klines cache for both playbooks (keeps intraday available for fallback on duplicate swing).
    await this._maybeWarmupKlines([symbol], [...intradayTfs, swingTf], "scan_pair_dual");

    const resultsIntraday = [];
    for (const tf of intradayTfs) {
      const r = evaluateSignal({
        symbol,
        tf,
        klines: this.klines,
        thresholds: this.thresholds,
        env: this.env,
        isAuto: false
      });
      if (r?.ok) resultsIntraday.push(r);
    }

    resultsIntraday.sort((a, b) => b.score - a.score);
    const topIntraday = resultsIntraday[0] || null;

    let topSwing = null;
    {
      const r = evaluateSignal({
        symbol,
        tf: swingTf,
        klines: this.klines,
        thresholds: this.thresholds,
        env: this.env,
        isAuto: false
      });
      if (r?.ok) {
        // 4h publish rule for /scan (LOCKED)
        if (String(r.tf).toLowerCase() === String(this.env.SECONDARY_TIMEFRAME || "4h").toLowerCase()) {
          if (String(symbol).toUpperCase() !== "ETHUSDT" && r.score < this.env.SECONDARY_MIN_SCORE) {
            topSwing = null;
          } else {
            topSwing = r;
          }
        } else {
          topSwing = r;
        }
      }
    }

    if (!topSwing && !topIntraday) return { primary: null, secondary: null };

    // Same pair rules (LOCKED):
    // - If both playbooks align direction => send 1 card (prefer SWING) with confluence tag.
    // - If both exist but opposite direction => do NOT send two directions; prefer SWING only.
    if (topSwing && topIntraday) {
      if (String(topSwing.direction) === String(topIntraday.direction)) {
        // Confluence (LOCK): keep secondary for fallback if SWING is duplicate.
        topSwing.confluence = "INTRADAY + SWING";
        topSwing.confluenceTfs = [topIntraday.tf, topSwing.tf];

        // Mirror on intraday too (helps fallback UX if primary is blocked)
        topIntraday.confluence = "INTRADAY + SWING";
        topIntraday.confluenceTfs = [topIntraday.tf, topSwing.tf];

        return { primary: topSwing, secondary: topIntraday };
      }
      return { primary: topSwing, secondary: null };
    }

    return topSwing
      ? { primary: topSwing, secondary: null }
      : { primary: topIntraday, secondary: null };
  }

  // /scan default (LOCKED): find best INTRADAY + best SWING across universe.
  // Output ideal: max 2 signals (Top 1 Intraday + Top 1 Swing), with guardrails.
  async scanBestDual(opts = null) {
    // Optional exclude list (used by /scan fallback rescan). Backward compatible.
    let excludeSymbols = [];
    if (Array.isArray(opts)) excludeSymbols = opts;
    else if (opts && typeof opts === "object") excludeSymbols = opts.excludeSymbols || opts.exclude || [];
    const excludeSet = new Set((excludeSymbols || []).map((s) => String(s || "").toUpperCase()).filter(Boolean));

    const symbolsAll = (this.universe.symbolsForScan?.() || this.universe.symbols?.() || []);
    const symbols = excludeSet.size
      ? symbolsAll.filter((s) => !excludeSet.has(String(s || "").toUpperCase()))
      : symbolsAll;
    const all = this._scanTimeframes();
    const swingTf = String(this.env?.SECONDARY_TIMEFRAME || "4h");
    const intradayTfs = all.filter((t) => !isSwingTf(t, this.env));

    const topN = Number(this.env?.TOP10_PER_TF ?? 10);

    // Warmup klines cache for top volume symbols to ensure intraday candidates exist (fastScore requires >=220 candles).
    const warmRows = await this.topVolumeCached(Math.min(symbols.length || 0, Math.max(6, topN)));
    const warmSymbols = (warmRows || []).map((r) => r.symbol).filter(Boolean);
    await this._maybeWarmupKlines(warmSymbols.length ? warmSymbols : symbols, [...intradayTfs, swingTf], "scan_best_dual");


    const intradayCandidates = [];
    for (const tf of intradayTfs) {
      const shortlist = symbols
        .map((s) => ({ symbol: s, tf, fast: this.ranker.fastScore(s, tf, this.thresholds) }))
        .sort((a, b) => b.fast - a.fast)
        .slice(0, topN);

      for (const row of shortlist) {
        if (row.fast <= 0) continue;
        const r = evaluateSignal({
          symbol: row.symbol,
          tf: row.tf,
          klines: this.klines,
          thresholds: this.thresholds,
          env: this.env,
          isAuto: false
        });
        if (r?.ok) intradayCandidates.push(r);
      }
    }


    // Fallback: if intradayCandidates is empty (common after cold start or cache gaps),
    // attempt a bounded scan on warmed/top-volume symbols without relying on fastScore.
    if (!intradayCandidates.length && intradayTfs.length) {
      const seedSyms = (warmSymbols && warmSymbols.length) ? warmSymbols : symbols.slice(0, Math.max(6, topN));
      const seen = new Set();
      for (const tf of intradayTfs) {
        for (const s of seedSyms.slice(0, Math.min(seedSyms.length, Math.max(6, topN)))) {
          const key = `${String(s).toUpperCase()}|${String(tf).toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const r = evaluateSignal({
            symbol: s,
            tf,
            klines: this.klines,
            thresholds: this.thresholds,
            env: this.env,
            isAuto: false
          });
          if (r?.ok) intradayCandidates.push(r);
        }
      }
      if (this.env?.LOG_LEVEL === "debug" && !intradayCandidates.length) {
        console.debug(`[SCAN] intraday_empty fallback_scanned syms=${seedSyms.length} tfs=${intradayTfs.join(",")}`);
      }
    }

    const swingCandidates = [];
    {
      const shortlist = symbols
        .map((s) => ({ symbol: s, tf: swingTf, fast: this.ranker.fastScore(s, swingTf, this.thresholds) }))
        .sort((a, b) => b.fast - a.fast)
        .slice(0, topN);

      for (const row of shortlist) {
        if (row.fast <= 0) continue;
        const r = evaluateSignal({
          symbol: row.symbol,
          tf: swingTf,
          klines: this.klines,
          thresholds: this.thresholds,
          env: this.env,
          isAuto: false
        });
        if (!r?.ok) continue;
        // 4h publish rule for /scan (LOCKED)
        if (String(r.symbol).toUpperCase() !== "ETHUSDT" && r.score < this.env.SECONDARY_MIN_SCORE) continue;
        swingCandidates.push(r);
      }
    }

    intradayCandidates.sort((a, b) => b.score - a.score);
    swingCandidates.sort((a, b) => b.score - a.score);

    const topIntraday = intradayCandidates[0] || null;
    const topSwing = swingCandidates[0] || null;

    if (!topSwing && !topIntraday) return { primary: null, secondary: null };

    // Prefer SWING as primary when available.
    if (topSwing && !topIntraday) return { primary: topSwing, secondary: null };
    if (!topSwing && topIntraday) return { primary: topIntraday, secondary: null };

    // Guardrail: if same pair
    if (String(topSwing.symbol) === String(topIntraday.symbol)) {
      if (String(topSwing.direction) === String(topIntraday.direction)) {
        // Confluence (LOCK): keep secondary for fallback if SWING is duplicate.
        topSwing.confluence = "INTRADAY + SWING";
        topSwing.confluenceTfs = [topIntraday.tf, topSwing.tf];

        // Mirror on intraday too (helps fallback UX if primary is blocked)
        topIntraday.confluence = "INTRADAY + SWING";
        topIntraday.confluenceTfs = [topIntraday.tf, topSwing.tf];

        return { primary: topSwing, secondary: topIntraday };
      }

      // Same pair but opposite direction => pick another intraday candidate (different symbol).
      const alt = intradayCandidates.find((c) => String(c.symbol) !== String(topSwing.symbol));
      return { primary: topSwing, secondary: alt || null };
    }

    return { primary: topSwing, secondary: topIntraday };
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
    const symbols = (this.universe.symbolsForAuto?.() || this.universe.symbols?.() || []);
    const tfs = this._autoTimeframes();

    const topUnion = new Map();
    const rankCache = [];

    // Rolling cooldown per pair+tf to prevent repeats (LOCKED intent)
    const pairTfCooldownMin = Number(this.env?.AUTO_PAIR_TF_COOLDOWN_MINUTES ?? this.env?.AUTO_COOLDOWN_MINUTES ?? 720);

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
      // Skip recently-sent pair+tf (rolling window)
      if (!this.stateRepo.canSendSymbol(`${row.symbol}|${row.tf}`, pairTfCooldownMin)) continue;
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