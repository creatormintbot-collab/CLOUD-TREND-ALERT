import { BinanceRest } from "./binanceRest.js";
import { BinanceWsGroup, chunkStreams } from "./binanceWs.js";

export class BinanceFutures {
  constructor(env, logger) {
    this.env = env;
    this.log = logger;

    this.rest = new BinanceRest({
      baseURL: env.BINANCE_FUTURES_REST,
      timeoutMs: env.REST_TIMEOUT_MS,
      retryMax: env.REST_RETRY_MAX,
      retryBaseMs: env.REST_RETRY_BASE_MS,
      logger
    });

    this.wsGroups = [];
  }

  async getPerpUsdtSymbols() {
    const info = await this.rest.exchangeInfo();
    const symbols = info.symbols
      .filter((s) => s.contractType === "PERPETUAL")
      .filter((s) => s.quoteAsset === "USDT")
      .filter((s) => s.status === "TRADING")
      .map((s) => s.symbol);
    return symbols;
  }

  async topPerpByVolume(n = 50) {
    const all = await this.rest.ticker24h();
    // use quoteVolume (USDT)
    const sorted = all
      .filter((x) => x.symbol && x.symbol.endsWith("USDT"))
      .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
      .slice(0, n)
      .map((x) => x.symbol);
    return sorted;
  }

  async backfillKlines(symbol, tf, limit = 300) {
    const rows = await this.rest.klines({ symbol, interval: tf, limit });
    return rows.map((r) => ({
      openTime: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
      closeTime: Number(r[6])
    }));
  }

  async markPrice(symbol) {
    const d = await this.rest.markPrice(symbol);
    // premiumIndex returns object for single symbol
    return Number(d.markPrice ?? d?.[0]?.markPrice);
  }

  /**
   * WS-first: subscribe klines for many symbols+tf.
   * handler receives payload with stream + data (binance combined stream format)
   */
  async subscribeKlines({ symbols, tfs, onKlineClosed }) {
    await this.unsubscribeAll();

    const streams = [];
    for (const sym of symbols) {
      for (const tf of tfs) {
        streams.push(`${sym.toLowerCase()}@kline_${tf}`);
      }
    }

    const chunks = chunkStreams(streams, this.env.WS_MAX_STREAMS_PER_SOCKET);
    this.wsGroups = chunks.map(
      (list, idx) =>
        new BinanceWsGroup({
          wsBase: this.env.BINANCE_FUTURES_WS,
          streams: list,
          logger: this.log,
          backoffBaseMs: this.env.WS_BACKOFF_BASE_MS,
          backoffMaxMs: this.env.WS_BACKOFF_MAX_MS,
          name: `klines-${idx + 1}`
        })
    );

    for (const g of this.wsGroups) {
      g.setHandler((msg) => {
        const data = msg?.data;
        if (!data?.e || data.e !== "kline") return;

        const k = data.k;
        if (!k?.x) return; // decision only on candle closed
        onKlineClosed({
          symbol: data.s,
          timeframe: k.i,
          candle: {
            openTime: Number(k.t),
            open: Number(k.o),
            high: Number(k.h),
            low: Number(k.l),
            close: Number(k.c),
            volume: Number(k.v),
            closeTime: Number(k.T)
          }
        });
      });
      await g.start();
    }
  }

  async unsubscribeAll() {
    for (const g of this.wsGroups) {
      await g.stop();
    }
    this.wsGroups = [];
  }
}
