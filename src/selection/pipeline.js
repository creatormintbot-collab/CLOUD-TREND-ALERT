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


async _maybeWarmupKlines(symbols, tfs, reason = "scan", opts = {}) {
  const minCandles = Number(opts?.minCandles ?? 220);
  const maxSyms = Number(opts?.maxSyms ?? 12);
  const retryMs = Number(opts?.retryMs ?? this.env?.SCAN_WARMUP_RETRY_MS ?? 120000);

  if (!Array.isArray(symbols) || symbols.length === 0) return;
  if (!Array.isArray(tfs) || tfs.length === 0) return;

  if (!this.klines || typeof this.klines.getCandles !== "function" || typeof this.klines.backfill !== "function") {
    return;
  }

  if (!this._warmupLocks) this._warmupLocks = new Map();
  const key = `${reason}|${tfs.map((x) => normTf(String(x))).join(",")}`;
  const now = Date.now();
  const last = this._warmupLocks.get(key) || 0;
  if (now - last < retryMs) return;

  const subset = symbols.slice(0, maxSyms);
  const needSymbols = [];
  for (const sym of subset) {
    let ok = true;
    for (const tf of tfs) {
      const n = (this.klines.getCandles(sym, tf) || []).length;
      if (!Number.isFinite(n) || n < minCandles) { ok = false; break; }
    }
    if (!ok) needSymbols.push(sym);
  }
  if (!needSymbols.length) return;

  this._warmupLocks.set(key, now);

  const log = (this.env?.LOG_LEVEL === "debug") ? console.debug : console.info;
  log(`[SCAN] warmup_backfill_start ${JSON.stringify({ reason, symbolCount: needSymbols.length, symbols: needSymbols.slice(0, 6), tfs })}`);

  try {
    await this.klines.backfill(needSymbols, tfs);
    const stillMissing = needSymbols.filter((sym) => tfs.some((tf) => ((this.klines.getCandles(sym, tf) || []).length < minCandles)));
    if (stillMissing.length) {
      log(`[SCAN] warmup_backfill_partial ${JSON.stringify({ reason, stillMissing: stillMissing.slice(0, 6), stillMissingCount: stillMissing.length })}`);
    } else {
      log(`[SCAN] warmup_backfill_done ${JSON.stringify({ reason, symbolCount: needSymbols.length, tfs })}`);
    }
  } catch (e) {
    console.warn(`[SCAN] warmup_backfill_error ${JSON.stringify({ reason, err: (e && (e.message || e.stack)) ? String(e.message || e.stack).slice(0, 400) : String(e) })}`);
  }
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

  // Dual Playbook scan for a single pair (LOCKED):
  // - INTRADAY: best of 15m/30m/1h
  // - SWING: 4h (SECONDARY_TIMEFRAME)
  // Returns { primary, secondary } where primary is preferred (SWING when available).

async scanPairDual(symbol) {
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return { primary: null, secondary: null };

  const swingTf = this.env.SECONDARY_TIMEFRAME || "4h";
  const scanTfs = this._scanTimeframes();
  const intradayTfs = scanTfs.filter((tf) => !isSwingTf(tf, this.env));
  const allTfs = Array.from(new Set([ ...intradayTfs, swingTf ]));

  // Ensure we have enough candles for both Intraday + Swing.
  try {
    await this._maybeWarmupKlines([sym], allTfs, "scanPairDual", { minCandles: 220, maxSyms: 1, retryMs: 60000 });
  } catch {}

  const results = [];
  for (const tf of allTfs) {
    const r = await evaluateSignal({
      symbol: sym,
      tf,
      klines: this.klines,
      thresholds: this.thresholds,
      env: this.env,
      isAuto: false,
      secondaryMinScore: this._secondaryMinScore(sym),
    });
    if (r?.ok) results.push(r);
  }

  const swingPool = results.filter((r) => isSwingTf(r.tf, this.env));
  const intraPool = results.filter((r) => !isSwingTf(r.tf, this.env));

  const topSwing = swingPool.sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;
  const topIntraday = intraPool.sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;

  return { primary: topSwing, secondary: topIntraday };
}

  // /scan default (LOCKED): find best INTRADAY + best SWING across universe.
  // Output ideal: max 2 signals (Top 1 Intraday + Top 1 Swing), with guardrails.

  async scanBestDual(opts = {}) {
    const excludeSet = new Set((opts?.excludeSymbols || []).map((s) => String(s || "").toUpperCase()).filter(Boolean));

    const swingTf = this.env.SECONDARY_TIMEFRAME || "4h";
    const scanTfs = this._scanTimeframes();
    const intradayTfs = scanTfs.filter((tf) => !isSwingTf(tf, this.env));
    const allTfs = Array.from(new Set([ ...intradayTfs, swingTf ]));

    // Candidate universe (symbols)
    const symbolsRaw = (typeof this.universe.symbolsForScan === "function" ? this.universe.symbolsForScan() : null) || [];
    const symbols = symbolsRaw
      .map((s) => String(s || "").toUpperCase())
      .filter((s) => s && !excludeSet.has(s));

    if (!symbols.length) return { primary: null, secondary: null };

    // Warmup klines for a small subset to avoid "all fastScore=0" due to missing candles.
    try {
      const warmRows = await this.topVolumeCached(Math.max(12, this.env.TOP10_PER_TF || 10));
      const warmSymbols = (warmRows && warmRows.length ? warmRows.map((r) => String(r.symbol || "").toUpperCase()) : symbols)
        .filter((s) => s && !excludeSet.has(s));
      await this._maybeWarmupKlines(warmSymbols, allTfs, "scanBestDual", { minCandles: 220, maxSyms: 12 });
    } catch {}

    const bestPerTf = [];
    for (const tf of scanTfs) {
      const scored = [];

      for (const sym of symbols) {
        const fast = this.ranker.fastScore(sym, tf, this.thresholds);
        if (fast <= 0) continue;
        scored.push({ symbol: sym, tf, fast });
      }

      scored.sort((a, b) => b.fast - a.fast);
      const shortlist = scored.slice(0, this.env.TOP10_PER_TF || 10);

      let best = null;
      for (const row of shortlist) {
        const res = await evaluateSignal({
          symbol: row.symbol,
          tf: row.tf,
          klines: this.klines,
          thresholds: this.thresholds,
          env: this.env,
          isAuto: false,
          secondaryMinScore: this._secondaryMinScore(row.symbol),
        });
        if (!res?.ok) continue;
        if (!best || (res.score || 0) > (best.score || 0)) best = res;
      }

      if (best) bestPerTf.push(best);
    }

    const swingPool = bestPerTf.filter((r) => isSwingTf(r.tf, this.env));
    const intraPool = bestPerTf.filter((r) => !isSwingTf(r.tf, this.env));

    const topSwing = swingPool.sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;
    const topIntraday = intraPool.sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;

    // Return Swing as primary, Intraday as secondary (LOCK)
    return { primary: topSwing, secondary: topIntraday };
  }


async scanBestIntraday(opts = {}) {
  const excludeSet = new Set((opts?.excludeSymbols || []).map((s) => String(s || "").toUpperCase()).filter(Boolean));

  const scanTfs = this._scanTimeframes();
  const intradayTfs = scanTfs.filter((tf) => !isSwingTf(tf, this.env));
  if (!intradayTfs.length) return null;

  const symbolsRaw = (typeof this.universe.symbolsForScan === "function" ? this.universe.symbolsForScan() : null) || [];
  const symbols = symbolsRaw
    .map((s) => String(s || "").toUpperCase())
    .filter((s) => s && !excludeSet.has(s));

  if (!symbols.length) return null;

  try {
    const warmRows = await this.topVolumeCached(Math.max(12, this.env.TOP10_PER_TF || 10));
    const warmSymbols = (warmRows && warmRows.length ? warmRows.map((r) => String(r.symbol || "").toUpperCase()) : symbols)
      .filter((s) => s && !excludeSet.has(s));
    await this._maybeWarmupKlines(warmSymbols, intradayTfs, "scanBestIntraday", { minCandles: 220, maxSyms: 12 });
  } catch {}

  const candidates = [];
  for (const tf of intradayTfs) {
    const scored = [];
    for (const sym of symbols) {
      const fast = this.ranker.fastScore(sym, tf, this.thresholds);
      if (fast <= 0) continue;
      scored.push({ symbol: sym, tf, fast });
    }

    scored.sort((a, b) => b.fast - a.fast);
    const shortlist = scored.slice(0, this.env.TOP10_PER_TF || 10);

    for (const row of shortlist) {
      const res = await evaluateSignal({
        symbol: row.symbol,
        tf: row.tf,
        klines: this.klines,
        thresholds: this.thresholds,
        env: this.env,
        isAuto: false,
        secondaryMinScore: this._secondaryMinScore(row.symbol),
      });
      if (res?.ok) candidates.push(res);
    }
  }

  candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
  return candidates[0] || null;
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
