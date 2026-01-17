import { binanceRest } from "../exchange/rest.js";
import { savePositions } from "./store.js";

export async function pollAndUpdatePositions({ positions, onTP1, onTP2, onTP3, onSL }) {
  const running = positions.filter((p) => p.status === "RUNNING");
  if (!running.length) return;

  // fetch prices sequentially for MVP (safe); can parallelize later
  for (const p of running) {
    const price = await binanceRest.price(p.symbol).catch(() => null);
    if (!Number.isFinite(price)) continue;

    const isLong = p.direction === "LONG";

    const hitTP1 = isLong ? price >= p.tp1 : price <= p.tp1;
    const hitTP2 = isLong ? price >= p.tp2 : price <= p.tp2;
    const hitTP3 = isLong ? price >= p.tp3 : price <= p.tp3;
    const hitSL = isLong ? price <= p.sl : price >= p.sl;

    if (hitSL) {
      p.status = "CLOSED";
      p.closedReason = "SL";
      p.closedPrice = price;
      p.closedAt = Date.now();
      await onSL?.(p, price);
      continue;
    }

    if (hitTP3 && !p.tp3Hit) {
      p.tp3Hit = true;
      p.tp2Hit = true;
      p.tp1Hit = true;
      p.status = "CLOSED";
      p.closedReason = "TP3";
      p.closedPrice = price;
      p.closedAt = Date.now();
      await onTP3?.(p, price);
      continue;
    }

    if (hitTP2 && !p.tp2Hit) {
      p.tp2Hit = true;
      p.tp1Hit = true;
      await onTP2?.(p, price);
    }

    if (hitTP1 && !p.tp1Hit) {
      p.tp1Hit = true;
      await onTP1?.(p, price);
    }
  }

  savePositions(positions);
}
