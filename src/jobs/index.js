import { ENV } from "../config/env.js";
import { createScannerJob } from "./scanner.js";
import { createPositionMonitorJob } from "./positionMonitor.js";
import { createDailyRecapJob } from "./dailyRecap.js";

export function startJobs({ candleStore, universeManager, positions, macroFeed }) {
  const scanner = createScannerJob({ candleStore, universeManager, positions, macroFeed });
  const posMon = createPositionMonitorJob({ positions });
  const recap = createDailyRecapJob();

  // Hook candle close events (WS-driven)
  candleStore.onClose(async (payload) => {
    await scanner.onCandleClosed(payload).catch((e) => console.error("[scanner]", e.message));
  });

  // Position lifecycle polling
  setInterval(() => {
    posMon.tick().catch((e) => console.error("[positionMonitor]", e.message));
  }, ENV.POSITION_POLL_MS);

  // Daily recap checker
  setInterval(() => {
    recap.tick().catch((e) => console.error("[dailyRecap]", e.message));
  }, ENV.DAILY_RECAP_CHECK_MS);

  return { scanner, posMon, recap };
}
