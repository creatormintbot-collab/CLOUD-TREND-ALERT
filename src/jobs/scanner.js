import { evaluateEntryLocked } from "../strategy/entryRules.js";
import { computeLevelsLocked } from "../strategy/levels.js";
import { computeScore } from "../selection/scoring.js";
import { rankCandidates } from "../selection/ranker.js";
import { macroContextProxy } from "../selection/macro.js";

export class Scanner {
  constructor({ env, logger, binance, candleStore, positionStore, bot, cardBuilder }) {
    this.env = env;
    this.log = logger;
    this.binance = binance;
    this.candles = candleStore;
    this.store = positionStore;
    this.bot = bot;
    this.card = cardBuilder;

    this.universe = this.store.getUniverse();
    this.macro = { btc4h: [], alt4h: [], ctx: { bias: "NEUTRAL" } };

    // alt basket proxy
    this.altBasketSymbols = ["ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT"];

    // ====== MINIMAL BACKPRESSURE GUARDS (prevents async backlog / heap growth) ======
    this._wsPending = 0;
    this._wsMaxPending = Number(this.env.WS_MAX_PENDING_EVAL ?? 200); // safe default
    this._evalLocks = new Set(); // per symbol+tf lock to avoid duplicate concurrent eval
  }

  getUniverse() {
    return this.universe;
  }

  async initUniverse() {
    if (this.universe?.length) return;
    const syms = await this.binance.topPerpByVolume(this.env.TOP_VOLUME_N);
    this.universe = syms;
    this.store.setUniverse(syms);
  }

  async backfillAllPrimary() {
    const tfs = this.env.SCAN_TIMEFRAMES;
    for (const sym of this.universe) {
      for (const tf of tfs) {
        if (this.candles.hasMin(sym, tf, 300)) continue;
        const rows = await this.binance.backfillKlines(sym, tf, 300);
        this.candles.set(sym, tf, rows);
      }
    }
    this.log.info("Backfill primary done");
  }

  async backfillMacro() {
    // BTC 4h
    const tf = this.env.SECONDARY_TIMEFRAME || "4h";
    const btc = await this.binance.backfillKlines("BTCUSDT", tf, 300);
    this.macro.btc4h = btc;

    // alt basket: proxy by average candle close of basket (build synthetic series)
    const altSeries = [];
    for (const s of this.altBasketSymbols) {
      const rows = await this.binance.backfillKlines(s, tf, 300);
      altSeries.push(rows);
    }
    const len = Math.min(...altSeries.map((x) => x.length));
    const synth = [];
    for (let i = 0; i < len; i++) {
      const close = altSeries.reduce((acc, arr) => acc + arr[i].close, 0) / altSeries.length;
      synth.push({ ...altSeries[0][i], close });
    }
    this.macro.alt4h = synth;
    this.macro.ctx = macroContextProxy({ btc4h: this.macro.btc4h, altBasket4h: this.macro.alt4h });
    this.log.info({ macro: this.macro.ctx }, "Macro backfilled");
  }

  async startAutoWs() {
    await this.binance.subscribeKlines({
      symbols: this.universe,
      tfs: this.env.SCAN_TIMEFRAMES,
      onKlineClosed: async ({ symbol, timeframe, candle }) => {
        this.candles.upsert(symbol, timeframe, candle);

        // ====== BACKPRESSURE: prevent unbounded pending async evals ======
        if (this._wsPending >= this._wsMaxPending) {
          this.log.warn(
            { symbol, timeframe, pending: this._wsPending, max: this._wsMaxPending },
            "WS eval backlog too high; skipping eval to protect memory"
          );
          return;
        }

        const lockKey = `${symbol}:${timeframe}`;
        if (this._evalLocks.has(lockKey)) {
          // prevent duplicate concurrent eval for same key during bursts/reconnects
          return;
        }

        this._wsPending++;
        this._evalLocks.add(lockKey);

        // Do not block WS handler with long awaits; but keep bounded pending.
        (async () => {
          try {
            await this._evaluateAndMaybeSend({ symbol, timeframe, manualRequest: false });
          } catch (e) {
            this.log.error({ symbol, timeframe, err: String(e) }, "WS eval error");
          } finally {
            this._evalLocks.delete(lockKey);
            this._wsPending--;
          }
        })();
      }
    });
  }

  async _evaluateAndMaybeSend({ symbol, timeframe, manualRequest }) {
    // daily cap for AUTO only (on-demand can still produce NO SIGNAL)
    if (!manualRequest && this.store.dailyLimitReached()) return;

    const candles = this.candles.get(symbol, timeframe);
    const evalRes = evaluateEntryLocked({ candles, env: this.env });
    if (!evalRes.ok) return;

    const direction = evalRes.direction;

    // cooldown applies to AUTO only
    if (!manualRequest && !this.store.canSendSignal({ symbol, timeframe, direction })) return;

    const entryMid = candles[candles.length - 1].close; // LOCKED: close candle CLOSED
    const levels = computeLevelsLocked({
      entryMid,
      atr14: evalRes.indicators.atr14,
      direction,
      env: this.env
    });

    const macro = this.macro.ctx;
    const score = computeScore({
      candles,
      indicators: evalRes.indicators,
      direction,
      macroBias: macro.bias
    });

    // 4h rule: secondary timeframe must meet minimum score
    if (timeframe === this.env.SECONDARY_TIMEFRAME && score.finalScore < this.env.SECONDARY_MIN_SCORE) {
      return;
    }

    const signal = {
      symbol,
      timeframe,
      direction,
      ...levels,
      score,
      macro,
      createdAt: Date.now()
    };

    // persist + open position
    const pos = {
      symbol,
      timeframe,
      direction,
      entryZoneLow: levels.entryZoneLow,
      entryZoneHigh: levels.entryZoneHigh,
      entryMid: levels.entryMid,
      sl: levels.sl,
      tp1: levels.tp1,
      tp2: levels.tp2,
      tp3: levels.tp3,
      tp1Hit: false,
      tp2Hit: false,
      tp3Hit: false,
      status: "RUNNING",
      openedAt: Date.now()
    };

    const chatId = this._autoTargetChatId();
    if (!chatId) return;

    await this.bot.sendMessage(chatId, this.card.entryCard({ signal }), {
      parse_mode: "HTML",
      disable_web_page_preview: true
    });

    this.store.markSignalSent({ symbol, timeframe, direction });
    this.store.appendSignalAudit({ ...signal, manualRequest });
    this.store.upsertPosition(pos);

    this.log.info({ symbol, timeframe, direction, score: score.finalScore, manualRequest }, "SIGNAL sent & position opened");
  }

  _autoTargetChatId() {
    // if TEST_SIGNALS_CHAT_ID is set, send only there
    if (this.env.TEST_SIGNALS_CHAT_ID) return this.env.TEST_SIGNALS_CHAT_ID;
    // else: if ALLOWED_GROUP_IDS exists, send to first as default
    if (this.env.ALLOWED_GROUP_IDS?.length) return this.env.ALLOWED_GROUP_IDS[0];
    if (this.env.TELEGRAM_CHAT_ID) return this.env.TELEGRAM_CHAT_ID;
    return null;
  }

  async scanOnDemand({ symbol, timeframe, chatId }) {
    // timeframe null => scan primary + secondary (4h) and pick best
    const primaryTfs = this.env.SCAN_TIMEFRAMES;
    const secondaryTf = this.env.SECONDARY_TIMEFRAME;
    const tfs = timeframe ? [timeframe] : [...primaryTfs, secondaryTf].filter(Boolean);

    const fourHEliteScore = Number(this.env.SECONDARY_MIN_SCORE ?? 80);
    const fourHMargin = Number(this.env.FOUR_H_MARGIN_OVER_INTRADAY ?? 5);
    const rotateMinutes = Number(this.env.ROTATE_EXCLUDE_MINUTES ?? 30);

    let symbols = [];
    if (symbol) {
      symbols = [symbol.endsWith("USDT") ? symbol : `${symbol}USDT`];
    } else {
      symbols = this.universe.slice(0, this.env.TOP_VOLUME_N);
    }

    // ensure backfill for requested
    for (const s of symbols) {
      for (const tf of tfs) {
        if (!this.candles.hasMin(s, tf, 300)) {
          const rows = await this.binance.backfillKlines(s, tf, 300);
          this.candles.set(s, tf, rows);
        }
      }
    }

    const candidates = [];

    for (const s of symbols) {
      for (const tf of tfs) {
        const candles = this.candles.get(s, tf);
        const evalRes = evaluateEntryLocked({ candles, env: this.env });
        if (!evalRes.ok) continue;

        const direction = evalRes.direction;

        // On-demand has NO daily cap and NO cooldown gate.
        // But do not create duplicate running position for the same symbol+tf.
        if (this._hasRunningPosition(s, tf)) continue;

        const entryMid = candles[candles.length - 1].close;
        const levels = computeLevelsLocked({
          entryMid,
          atr14: evalRes.indicators.atr14,
          direction,
          env: this.env
        });

        const macro = this.macro.ctx;
        const score = computeScore({
          candles,
          indicators: evalRes.indicators,
          direction,
          macroBias: macro.bias
        });

        if (tf === this.env.SECONDARY_TIMEFRAME && score.finalScore < fourHEliteScore) {
          continue;
        }

        candidates.push({
          symbol: s,
          timeframe: tf,
          direction,
          levels,
          score,
          macro,
          indicators: evalRes.indicators
        });
      }
    }

    if (!candidates.length) {
      return {
        ok: false,
        reasons: ["No valid setup found (LOCKED entry rules)", "Or cooldown active", "Or insufficient data"]
      };
    }

    // Rank candidates (keep a short list for selection logic)
    const ranked = rankCandidates(candidates, Math.min(10, candidates.length));

    let chosen = null;

    if (symbol && !timeframe) {
      // best intraday
      const intraday = ranked.filter((c) => c.timeframe !== secondaryTf);
      const bestIntraday = intraday[0] ?? null;

      const best4h = ranked.find((c) => c.timeframe === secondaryTf) ?? null;
      if (
        best4h &&
        best4h.score?.finalScore >= fourHEliteScore &&
        (!bestIntraday || best4h.score.finalScore >= (bestIntraday.score?.finalScore ?? 0) + fourHMargin)
      ) {
        chosen = best4h;
      } else {
        chosen = bestIntraday;
      }
    } else if (!symbol && !timeframe) {
      // rotation for /scan (no args)
      const last = this.store.getOnDemandLast(chatId);
      const shouldExclude = last && last.symbol && (Date.now() - (last.ts ?? 0)) / 60000 < rotateMinutes;

      if (shouldExclude) {
        chosen = ranked.find((c) => c.symbol !== last.symbol) ?? ranked[0];
      } else {
        chosen = ranked[0];
      }
    } else {
      chosen = ranked[0];
    }

    const top = chosen;
    if (!top) {
      return { ok: false, reasons: ["No valid setup found (LOCKED entry rules)"] };
    }

    const signal = {
      symbol: top.symbol,
      timeframe: top.timeframe,
      direction: top.direction,
      ...top.levels,
      score: top.score,
      macro: top.macro,
      createdAt: Date.now()
    };

    // open position + persist (on-demand also opens lifecycle tracking)
    const pos = {
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      direction: signal.direction,
      entryZoneLow: signal.entryZoneLow,
      entryZoneHigh: signal.entryZoneHigh,
      entryMid: signal.entryMid,
      sl: signal.sl,
      tp1: signal.tp1,
      tp2: signal.tp2,
      tp3: signal.tp3,
      tp1Hit: false,
      tp2Hit: false,
      tp3Hit: false,
      status: "RUNNING",
      openedAt: Date.now()
    };

    // On-demand: DO NOT increment dailyCount (no daily limit).
    // But we still set cooldown timestamp to avoid immediate duplicate picks in AUTO / logs.
    try {
      const key = `${signal.symbol}:${signal.timeframe}:${signal.direction}`;
      if (this.store?.state?.cooldown) {
        this.store.state.cooldown[key] = Date.now();
        this.store.save();
      }
    } catch {
      // ignore
    }

    this.store.appendSignalAudit({ ...signal, manualRequest: true, requestedByChat: chatId });
    this.store.upsertPosition(pos);

    // Save last pick for /scan rotation
    this.store.setOnDemandLast(chatId, { symbol: signal.symbol, ts: Date.now() });

    return { ok: true, signal };
  }

  _hasRunningPosition(symbol, timeframe) {
    const running = this.store.listRunning();
    return running.some((p) => p.symbol === symbol && p.timeframe === timeframe);
  }
}
