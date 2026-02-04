import { evaluateSignal, explainSignal, evaluateIntradayTradePlan } from "../strategy/signalEngine.js";
import { macdGate } from "../strategy/scoring/proScore.js";
import { macd } from "../strategy/indicators/macd.js";
import { INTRADAY_SCAN_TOP_N, INTRADAY_MIN_CANDLES, INTRADAY_TIMEFRAMES, SWING_SCAN_TOP_N } from "../config/constants.js";


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
    this.lastAutoStats = null;
  }

  _scanTimeframes() {
    const base = Array.isArray(this.env?.SCAN_TIMEFRAMES) ? this.env.SCAN_TIMEFRAMES : [];
    const sec = this.env?.SECONDARY_TIMEFRAME;
    const tfs = [...base];
    if (sec && !tfs.includes(sec)) tfs.push(sec);
    return tfs;
  }

  _intradayTfs() {
    const signalTfs = this._intradaySignalTfs();
    const biasTfs = signalTfs.map((tf) => this._intradayBiasTf(tf));
    return Array.from(new Set([...signalTfs, ...biasTfs, "12h"]));
  }

  _intradaySignalTfs() {
    const base = Array.isArray(INTRADAY_TIMEFRAMES) ? INTRADAY_TIMEFRAMES : [];
    const tfs = base.length ? base : ["15m", "30m", "1h"];
    return tfs.map((tf) => normTf(tf)).filter(Boolean);
  }

  _intradayBiasTf(signalTf) {
    return normTf(signalTf) === "1h" ? "4h" : "1h";
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
    const results = [];
    const swing = await this.scanPairSwing(symbol);
    if (swing?.ok) results.push(swing);

    const intraday = await this.scanPairIntraday(symbol);
    if (intraday?.ok) results.push(intraday);

    if (!results.length) return null;
    results.sort((a, b) => (b.score || 0) - (a.score || 0));
    return results[0] || null;
  }

  async scanPairTf(symbol, tf) {
    if (isSwingTf(tf, this.env)) return this.scanPairSwing(symbol);
    return this.scanPairIntraday(symbol, tf);
  }

  async scanPairIntraday(symbol, tf) {
    const sym = String(symbol || "").toUpperCase();
    if (!sym) return null;

    try {
      await this._maybeWarmupKlines([sym], this._intradayTfs(), "scanPairIntraday", { minCandles: INTRADAY_MIN_CANDLES, maxSyms: 1, retryMs: 60000 });
    } catch {}

    const signalTfs = tf ? [normTf(tf)] : this._intradaySignalTfs();
    let best = null;

    for (const signalTf of signalTfs) {
      const r = evaluateIntradayTradePlan({
        symbol: sym,
        tf: signalTf,
        klines: this.klines,
        thresholds: this.thresholds,
        env: this.env
      });
      if (r?.ok && (!best || (r.score || 0) > (best.score || 0))) best = r;
    }

    return best;
  }

  async scanPairSwing(symbol) {
    const sym = String(symbol || "").toUpperCase();
    if (!sym) return null;

    const swingTf = this.env.SECONDARY_TIMEFRAME || "4h";
    try {
      await this._maybeWarmupKlines([sym], [swingTf], "scanPairSwing", { minCandles: INTRADAY_MIN_CANDLES, maxSyms: 1, retryMs: 60000 });
    } catch {}

    const r = evaluateSignal({
      symbol: sym,
      tf: swingTf,
      klines: this.klines,
      thresholds: this.thresholds,
      env: this.env,
      isAuto: false
    });

    if (!r?.ok) return null;
    if (swingTf === this.env.SECONDARY_TIMEFRAME && sym !== "ETHUSDT" && r.score < this.env.SECONDARY_MIN_SCORE) return null;
    return r;
  }

  // Dual Playbook scan for a single pair (LOCKED):
  // - INTRADAY: SR Trade Plan (15m/30m/1h signals + 1h/4h bias + 12h macro)
  // - SWING: 4h (SECONDARY_TIMEFRAME)
  // Returns { primary, secondary } where primary is preferred (SWING when available).

  async scanPairDual(symbol) {
    const sym = String(symbol || "").toUpperCase();
    if (!sym) return { primary: null, secondary: null };

    const swingTf = this.env.SECONDARY_TIMEFRAME || "4h";
    const allTfs = Array.from(new Set([ ...this._intradayTfs(), swingTf ]));

    // Ensure we have enough candles for both Intraday + Swing.
    try {
      await this._maybeWarmupKlines([sym], allTfs, "scanPairDual", { minCandles: INTRADAY_MIN_CANDLES, maxSyms: 1, retryMs: 60000 });
    } catch {}

    const topSwing = await this.scanPairSwing(sym);
    const topIntraday = await this.scanPairIntraday(sym);

    return { primary: topSwing || null, secondary: topIntraday || null };
  }

  // /scan default (LOCKED): find best INTRADAY + best SWING across universe.
  // Output ideal: max 2 signals (Top 1 Intraday + Top 1 Swing), with guardrails.

  async scanIntradayPlans(opts = {}) {
    const excludeSet = new Set((opts?.excludeSymbols || []).map((s) => String(s || "").toUpperCase()).filter(Boolean));
    const limit = Number(opts?.limit ?? INTRADAY_SCAN_TOP_N);

    const symbolsRaw = Array.isArray(opts?.symbols) && opts.symbols.length
      ? opts.symbols
      : ((typeof this.universe.symbolsForScan === "function" ? this.universe.symbolsForScan() : null) || []);

    const symbols = symbolsRaw
      .map((s) => String(s || "").toUpperCase())
      .filter((s) => s && !excludeSet.has(s));

    if (!symbols.length) return [];

    try {
      const warmRows = await this.topVolumeCached(Math.max(12, this.env.TOP10_PER_TF || 10));
      const warmSymbols = (warmRows && warmRows.length ? warmRows.map((r) => String(r.symbol || "").toUpperCase()) : symbols)
        .filter((s) => s && !excludeSet.has(s));
      await this._maybeWarmupKlines(warmSymbols, this._intradayTfs(), "scanIntradayPlans", { minCandles: INTRADAY_MIN_CANDLES, maxSyms: 12 });
    } catch {}

    const candidates = [];
    const signalTfs = this._intradaySignalTfs();

    for (const signalTf of signalTfs) {
      const scored = [];
      for (const sym of symbols) {
        const fast = typeof this.ranker.fastScoreIntraday === "function"
          ? this.ranker.fastScoreIntraday(sym, signalTf, this.thresholds)
          : this.ranker.fastScore(sym, this._intradayBiasTf(signalTf), this.thresholds);
        if (fast <= 0) continue;
        scored.push({ symbol: sym, tf: signalTf, fast });
      }

      scored.sort((a, b) => b.fast - a.fast);
      const shortlist = scored.slice(0, this.env.TOP10_PER_TF || 10);

      for (const row of shortlist) {
        const res = evaluateIntradayTradePlan({
          symbol: row.symbol,
          tf: row.tf,
          klines: this.klines,
          thresholds: this.thresholds,
          env: this.env
        });
        if (res?.ok) candidates.push(res);
      }
    }

    candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
    return candidates.slice(0, Number.isFinite(limit) ? limit : INTRADAY_SCAN_TOP_N);
  }

  async scanSwingSignals(opts = {}) {
    const excludeSet = new Set((opts?.excludeSymbols || []).map((s) => String(s || "").toUpperCase()).filter(Boolean));
    const limit = Number(opts?.limit ?? SWING_SCAN_TOP_N);

    const swingTf = this.env.SECONDARY_TIMEFRAME || "4h";
    const symbolsRaw = Array.isArray(opts?.symbols) && opts.symbols.length
      ? opts.symbols
      : ((typeof this.universe.symbolsForScan === "function" ? this.universe.symbolsForScan() : null) || []);

    const symbols = symbolsRaw
      .map((s) => String(s || "").toUpperCase())
      .filter((s) => s && !excludeSet.has(s));

    if (!symbols.length) return [];

    try {
      const warmRows = await this.topVolumeCached(Math.max(12, this.env.TOP10_PER_TF || 10));
      const warmSymbols = (warmRows && warmRows.length ? warmRows.map((r) => String(r.symbol || "").toUpperCase()) : symbols)
        .filter((s) => s && !excludeSet.has(s));
      await this._maybeWarmupKlines(warmSymbols, [swingTf], "scanSwingSignals", { minCandles: INTRADAY_MIN_CANDLES, maxSyms: 12 });
    } catch {}

    const scored = [];
    for (const sym of symbols) {
      const fast = this.ranker.fastScore(sym, swingTf, this.thresholds);
      if (fast <= 0) continue;
      scored.push({ symbol: sym, fast });
    }

    scored.sort((a, b) => b.fast - a.fast);
    const shortlist = scored.slice(0, this.env.TOP10_PER_TF || 10);

    const candidates = [];
    for (const row of shortlist) {
      const res = evaluateSignal({
        symbol: row.symbol,
        tf: swingTf,
        klines: this.klines,
        thresholds: this.thresholds,
        env: this.env,
        isAuto: false
      });
      if (!res?.ok) continue;
      if (swingTf === this.env.SECONDARY_TIMEFRAME && String(row.symbol).toUpperCase() !== "ETHUSDT" && res.score < this.env.SECONDARY_MIN_SCORE) continue;
      candidates.push(res);
    }

    candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
    return candidates.slice(0, Number.isFinite(limit) ? limit : SWING_SCAN_TOP_N);
  }

  async scanLists(opts = {}) {
    const intraday = await this.scanIntradayPlans(opts);
    const swing = await this.scanSwingSignals(opts);
    return { intraday, swing };
  }

  async scanBestDual(opts = {}) {
    const intraday = await this.scanIntradayPlans(opts);
    const swing = await this.scanSwingSignals(opts);
    return { primary: swing[0] || null, secondary: intraday[0] || null };
  }


  async scanBestIntraday(opts = {}) {
    const list = await this.scanIntradayPlans(opts);
    return list[0] || null;
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

    const stats = {
      symbols: symbols.length,
      tfs: tfs.length,
      topUnion: 0,
      pairTfCooldownBlocked: 0,
      evaluated: 0,
      evalOk: 0,
      scoreTooLow: 0,
      macdFail: 0,
      secondaryScoreFail: 0,
      candidates: 0
    };

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

    stats.topUnion = topUnion.size;

    const candidates = [];
    for (const row of topUnion.values()) {
      // Skip recently-sent pair+tf (rolling window)
      if (!this.stateRepo.canSendSymbol(`${row.symbol}|${row.tf}`, pairTfCooldownMin)) {
        stats.pairTfCooldownBlocked += 1;
        continue;
      }
      stats.evaluated += 1;
      const r = evaluateSignal({
        symbol: row.symbol,
        tf: row.tf,
        klines: this.klines,
        thresholds: this.thresholds,
        env: this.env,
        isAuto: true
      });
      if (!r?.ok) continue;
      stats.evalOk += 1;

      // AUTO filters (LOCKED)
      if (r.score < this.env.AUTO_MIN_SCORE) {
        stats.scoreTooLow += 1;
        continue;
      }

      // MACD gate must pass for AUTO
      const closes = r.candles.map((c) => Number(c.close));
      const m = macd(closes, 12, 26, 9);
      if (!macdGate({ direction: r.direction, hist: m.hist })) {
        stats.macdFail += 1;
        continue;
      }

      // 4h publish rule (LOCKED)
      if (r.tf === this.env.SECONDARY_TIMEFRAME && String(r.symbol).toUpperCase() !== "ETHUSDT" && r.score < this.env.SECONDARY_MIN_SCORE) {
        stats.secondaryScoreFail += 1;
        continue;
      }

      candidates.push(r);
      stats.candidates += 1;
      rankCache.push({ symbol: r.symbol, tf: r.tf, score: r.score });
    }

    rankCache.sort((a, b) => b.score - a.score);
    this.stateRepo.setRankCache(rankCache.slice(0, 50));
    await this.stateRepo.flush();

    candidates.sort((a, b) => b.score - a.score);
    this.lastAutoStats = { ...stats };
    return candidates;
  }
}
