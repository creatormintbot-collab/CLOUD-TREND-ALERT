import { ema } from "../indicators/ema.js";
import { checkLifecycle } from "../positions/monitor.js";

export function startPriceMonitor({ env, logger, binance, candleStore, positionStore, bot, cardBuilder }) {
  let inFlight = false;
  let lastTickMs = 0;

  const tick = async () => {
    // HARD GUARD: never allow overlapping ticks (prevents async backlog / heap growth)
    if (inFlight) {
      logger.warn({ since_ms: Date.now() - lastTickMs }, "priceMonitor tick skipped (previous tick still running)");
      return;
    }

    inFlight = true;
    lastTickMs = Date.now();

    try {
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
        const c = candleStore.get(p.symbol, p.timeframe) || [];

        // NOTE: this is allocation-heavy but bounded; the overlap guard above prevents unbounded growth
        const closes = c.map((x) => x.close);
        const ema55 = closes.length >= 55 ? ema(closes, 55) : null;

        const { events, updatedPosition } = checkLifecycle({
          position: p,
          markPrice: mark,
          ema55,
          env
        });

        if (!events.length) {
          // keep store in sync if monitor updates flags without emitting events (rare)
          if (updatedPosition && updatedPosition !== p) {
            positionStore.updatePosition(updatedPosition);
          }
          continue;
        }

        // send events in order
        for (const ev of events) {
          // safety: if TP3 already hit/closed, never emit SL for this same position
          if (ev.type === "SL" && updatedPosition?.tp3Hit) continue;

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
          const closeOutcome = updatedPosition.closeOutcome;
          let win = updatedPosition.tp3Hit || updatedPosition.tp2Hit || updatedPosition.tp1Hit;

          // outcome-aware (keeps backward compatibility)
          if (closeOutcome === "LOSS") win = false;
          if (closeOutcome === "PROFIT_FULL" || closeOutcome === "PROFIT_PARTIAL") win = true;

          positionStore.closePosition({
            symbol: updatedPosition.symbol,
            timeframe: updatedPosition.timeframe,
            reason: updatedPosition.tp3Hit ? "TP3" : "SL",
            win,
            closeOutcome
          });

          logger.info(
            { symbol: updatedPosition.symbol, tf: updatedPosition.timeframe, win, closeOutcome },
            "Position CLOSED"
          );
        } else {
          positionStore.updatePosition(updatedPosition);
        }
      }
    } finally {
      inFlight = false;
    }
  };

  const intervalSec = Number(env.PRICE_MONITOR_INTERVAL_SEC) || 15;
  const handle = setInterval(() => {
    tick().catch((e) => logger.error({ err: String(e) }, "priceMonitor tick error"));
  }, intervalSec * 1000);

  return () => clearInterval(handle);
}
