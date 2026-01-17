import { ENV } from "./config/env.js";
import { createUniverseManager } from "./market/universe.js";
import { createCandleStore } from "./market/candleStore.js";
import { binanceRest } from "./exchange/rest.js";
import { createKlineWS } from "./exchange/ws.js";
import { loadPositions } from "./positions/store.js";
import { startJobs } from "./jobs/index.js";
import { macroAltStrength, macroBTCTrend, macroBias, macroAdj } from "./strategy/macro.js";
import { computeCoreIndicators } from "./strategy/intradayPro.js";

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function backfillSymbolTF(candleStore, symbol, tf, limit) {
  const raw = await binanceRest.klines(symbol, tf, limit);
  const candles = raw.map(candleStore.klineToCandle);
  candleStore.set(symbol, tf, candles);
}

async function backfillUniverse(candleStore, universe, tfs) {
  for (const tf of tfs) {
    for (const symbol of universe) {
      await backfillSymbolTF(candleStore, symbol, tf, ENV.BACKFILL_CANDLES).catch((e) => {
        console.error(`[backfill] ${symbol} ${tf} failed`, e.message);
      });
    }
  }
}

function buildStreams(universe, tfs) {
  const streams = [];
  for (const sym of universe) {
    const s = sym.toLowerCase();
    for (const tf of tfs) {
      streams.push(`${s}@kline_${tf}`);
    }
  }
  return streams;
}

function createMacroFeed({ candleStore, universeManager }) {
  const macro = { tf: ENV.MACRO_TF, btcTrend: "FLAT", altStrength: "FLAT", bias: "NEUTRAL", adj: 0 };
  const feed = { snapshot: macro };

  async function refresh() {
    const universe = await universeManager.refreshIfNeeded(false);

    // ensure BTC + ETH are available (likely yes)
    const btc = candleStore.get("BTCUSDT", ENV.MACRO_TF);
    const eth = candleStore.get("ETHUSDT", ENV.MACRO_TF);

    if (!btc.length) {
      await backfillSymbolTF(candleStore, "BTCUSDT", ENV.MACRO_TF, ENV.BACKFILL_CANDLES).catch(() => {});
    }
    if (!eth.length) {
      await backfillSymbolTF(candleStore, "ETHUSDT", ENV.MACRO_TF, ENV.BACKFILL_CANDLES).catch(() => {});
    }

    // alt basket: top N excluding BTC/ETH
    const alts = universe.filter((s) => s !== "BTCUSDT" && s !== "ETHUSDT").slice(0, ENV.MACRO_BASKET_SIZE);
    const altCandles = [];
    for (const a of alts) {
      const c = candleStore.get(a, ENV.MACRO_TF);
      if (!c.length) {
        await backfillSymbolTF(candleStore, a, ENV.MACRO_TF, ENV.BACKFILL_CANDLES).catch(() => {});
      }
      const cc = candleStore.get(a, ENV.MACRO_TF);
      if (cc.length) altCandles.push(cc);
    }

    const btcTrend = macroBTCTrend(candleStore.get("BTCUSDT", ENV.MACRO_TF));
    const altStrength = macroAltStrength(altCandles);
    const bias = macroBias({ btcTrend, altStrength });

    feed.snapshot = {
      tf: ENV.MACRO_TF,
      btcTrend,
      altStrength,
      bias,
      adj: 0, // per-signal computed later
    };
  }

  return { feed, refresh };
}

async function start4hPolling({ candleStore, universeManager }) {
  const tf = ENV.SECONDARY_TIMEFRAME;

  setInterval(async () => {
    const universe = await universeManager.refreshIfNeeded(false);
    for (const sym of universe) {
      const raw = await binanceRest.klines(sym, tf, ENV.BACKFILL_CANDLES).catch(() => null);
      if (!raw) continue;
      const candles = raw.map(candleStore.klineToCandle);
      candleStore.set(sym, tf, candles);

      // emit close event for latest candle (treated as closed snapshot)
      const last = candles[candles.length - 1];
      if (last) {
        candleStore.emitClose({ symbol: sym, tf, candle: last });
      }
    }
  }, ENV.TF4H_POLL_MS);
}

async function main() {
  log(`[BOOT] ${ENV.BOT_NAME} starting...`);

  const positions = loadPositions();
  const universeManager = createUniverseManager();
  const candleStore = createCandleStore();

  const universe = await universeManager.refreshIfNeeded(true);
  log(`[UNIVERSE] size=${universe.length}`);

  // Backfill primary + macro + 4h
  const primaryTFs = ENV.SCAN_TIMEFRAMES;
  const allTFs = Array.from(new Set([...primaryTFs, ENV.MACRO_TF, ENV.SECONDARY_TIMEFRAME]));
  log(`[BACKFILL] candles=${ENV.BACKFILL_CANDLES} TFs=${allTFs.join(",")}`);
  await backfillUniverse(candleStore, universe, allTFs);

  // Macro feed
  const macroFeed = createMacroFeed({ candleStore, universeManager });
  await macroFeed.refresh();

  // Start jobs
  startJobs({ candleStore, universeManager, positions, macroFeed: macroFeed.feed });

  // WS for 15m/30m/1h
  const streams = buildStreams(universe, primaryTFs);
  log(`[WS] streams=${streams.length}`);

  let ws = null;
  let reconnectTimer = null;

  const connect = () => {
    ws = createKlineWS({
      streams,
      onOpen: () => log("[WS] connected"),
      onClose: (code, reason) => {
        log(`[WS] closed code=${code} reason=${reason}`);
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(async () => {
            reconnectTimer = null;
            // REST backfill to close gaps (simple approach)
            const uni = await universeManager.refreshIfNeeded(false);
            await backfillUniverse(candleStore, uni, primaryTFs);
            connect();
          }, 3000);
        }
      },
      onError: (e) => log("[WS] error", e.message),
      onMessage: (msg) => {
        const parsed = candleStore.wsKlineToCandle(msg);
        if (!parsed) return;

        const { symbol, tf, isClosed, candle } = parsed;
        candleStore.appendOrUpdate(symbol, tf, candle);
        candleStore.trim(symbol, tf);

        if (isClosed) {
          candleStore.emitClose({ symbol, tf, candle });
          // refresh macro periodically using close events (cheap heuristic)
          if (symbol === "BTCUSDT" && tf === ENV.MACRO_TF) {
            macroFeed.refresh().catch(() => {});
          }
        }
      },
    });
  };

  connect();

  // Secondary TF polling
  await start4hPolling({ candleStore, universeManager });

  log("[BOOT] running ✅");
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
