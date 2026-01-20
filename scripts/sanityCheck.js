import "dotenv/config";
import { env } from "../src/config/env.js";
import { validateEnvOrThrow } from "../src/config/validate.js";
import { RestClient } from "../src/exchange/restClient.js";
import { WsManager } from "../src/exchange/wsManager.js";
import { KlinesService } from "../src/exchange/klinesService.js";
import { buildOverlays } from "../src/charts/layout.js";
import { renderEntryChart } from "../src/charts/renderer.js";

async function main() {
  validateEnvOrThrow();

  const rest = new RestClient({
    baseUrl: env.BINANCE_FUTURES_REST,
    timeoutMs: env.REST_TIMEOUT_MS,
    retryMax: env.REST_RETRY_MAX,
    retryBaseMs: env.REST_RETRY_BASE_MS
  });

  console.log("[sanity] exchangeInfo...");
  await rest.exchangeInfo();

  console.log("[sanity] premiumIndex BTCUSDT...");
  const p = await rest.premiumIndex({ symbol: "BTCUSDT" });
  console.log("[sanity] markPrice:", p?.markPrice);

  const ws = new WsManager({
    wsBase: env.BINANCE_FUTURES_WS,
    maxStreamsPerSocket: env.WS_MAX_STREAMS_PER_SOCKET,
    backoffBaseMs: env.WS_BACKOFF_BASE_MS,
    backoffMaxMs: env.WS_BACKOFF_MAX_MS
  });

  const klines = new KlinesService({ rest, wsManager: ws, backfillLimit: 300, maxCandles: 800 });

  console.log("[sanity] backfill BTCUSDT 15m...");
  await klines.backfill(["BTCUSDT"], ["15m"]);
  const candles = klines.getCandles("BTCUSDT", "15m");
  console.log("[sanity] candles:", candles.length, "lastClose:", candles.at(-1)?.closeTime);

  const last = candles.at(-1)?.close || 0;
  const fakeSignal = {
    symbol: "BTCUSDT",
    tf: "15m",
    levels: {
      entryLow: last * 0.999,
      entryHigh: last * 1.001,
      entryMid: last,
      sl: last * 0.995,
      tp1: last * 1.005,
      tp2: last * 1.01,
      tp3: last * 1.02
    },
    candles
  };

  const overlays = buildOverlays(fakeSignal);
  const png = await renderEntryChart(fakeSignal, overlays, "sanity");
  console.log("[sanity] png bytes:", png.length);

  await ws.stop();
  console.log("[sanity] OK");
}

main().catch((e) => {
  console.error("[sanity] FAIL:", e);
  process.exit(1);
});
