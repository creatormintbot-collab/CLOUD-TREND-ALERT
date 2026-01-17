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
    const tf = this.env.SECONDARY_TIMEFRAME;
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

        // AUTO scanning entry on close
        await this._evaluateAndMaybeSend({ symbol, timeframe, manualRequest: false });
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

    if (!this.store.canSendSignal({ symbol, timeframe, direction })) return;

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

    // 4h rule: send only if score >= 75 (secondary only)
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
    // timeframe null => scan all primary & pick best 1-3
    const tfs = timeframe ? [timeframe] : this.env.SCAN_TIMEFRAMES;

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

        if (!this.store.canSendSignal({ symbol: s, timeframe: tf, direction })) {
          continue;
        }

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

        if (tf === this.env.SECONDARY_TIMEFRAME && score.finalScore < this.env.SECONDARY_MIN_SCORE) {
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
        reasons: [
          "No valid setup found (LOCKED entry rules)",
          "Or cooldown active",
          "Or insufficient data"
        ]
      };
    }

    const top = rankCandidates(candidates, 1)[0];

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

    this.store.markSignalSent({
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      direction: signal.direction
    });
    this.store.appendSignalAudit({ ...signal, manualRequest: true, requestedByChat: chatId });
    this.store.upsertPosition(pos);

    return { ok: true, signal };
  }
}
