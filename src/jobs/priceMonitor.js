import { ema } from "../indicators/ema.js";
import { checkLifecycle } from "../positions/monitor.js";

export function startPriceMonitor({ env, logger, binance, candleStore, positionStore, bot, cardBuilder }) {
  const tick = async () => {
    const running = positionStore.listRunning();
    if (!running.length) return;

    // group by symbol to reduce REST calls
    const uniqSymbols = [...new Set(running.map((p) => p.symbol))];

    const prices = new Map();
    for (const s of uniqSymbols) {
      try {
        const mp = await binance.markPrice(s);
        prices.set(s, mp);
      } catch (e) {
        logger.warn({ symbol: s, err: String(e) }, "markPrice failed");
      }
    }

    for (const p of running) {
      const mark = prices.get(p.symbol);
      if (!mark) continue;

      // EMA55 from current TF candles (for TP2 suggested SL)
      const c = candleStore.get(p.symbol, p.timeframe);
      const closes = c.map((x) => x.close);
      const ema55 = ema(closes, 55);

      const { events, updatedPosition } = checkLifecycle({
        position: p,
        markPrice: mark,
        ema55,
        env
      });

      if (!events.length) continue;

      // send events in order
      for (const ev of events) {
        if (ev.type === "TP1" || ev.type === "TP2" || ev.type === "TP3") {
          await bot.sendMessage(
            env.TEST_SIGNALS_CHAT_ID || (env.ALLOWED_GROUP_IDS?.[0] ?? env.TELEGRAM_CHAT_ID),
            cardBuilder.tpCard({
              position: updatedPosition,
              type: ev.type,
              suggestedSL: ev.suggestedSL,
              actions: ev.action
            }),
            { parse_mode: "HTML", disable_web_page_preview: true }
          );
        } else if (ev.type === "SL") {
          await bot.sendMessage(
            env.TEST_SIGNALS_CHAT_ID || (env.ALLOWED_GROUP_IDS?.[0] ?? env.TELEGRAM_CHAT_ID),
            cardBuilder.slCard({ position: updatedPosition }),
            { parse_mode: "HTML", disable_web_page_preview: true }
          );
        }
      }

      // persist position status
      if (updatedPosition.status === "CLOSED") {
        const win = updatedPosition.tp3Hit || updatedPosition.tp2Hit || updatedPosition.tp1Hit;
        positionStore.closePosition({
          symbol: updatedPosition.symbol,
          timeframe: updatedPosition.timeframe,
          reason: updatedPosition.tp3Hit ? "TP3" : "SL",
          win
        });
        logger.info({ symbol: updatedPosition.symbol, tf: updatedPosition.timeframe, win }, "Position CLOSED");
      } else {
        positionStore.updatePosition(updatedPosition);
      }
    }
  };

  const handle = setInterval(() => {
    tick().catch((e) => logger.error({ err: String(e) }, "priceMonitor tick error"));
  }, env.PRICE_MONITOR_INTERVAL_SEC * 1000);

  return () => clearInterval(handle);
}
