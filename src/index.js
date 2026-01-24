import "dotenv/config";
import { logger } from "./logger/logger.js";
import { bootstrap } from "./lifecycle/bootstrap.js";
import { setupGracefulShutdown } from "./lifecycle/gracefulShutdown.js";

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "unhandledRejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "uncaughtException");
  // Safer to let PM2 restart in truly unknown states.
  setTimeout(() => process.exit(1), 250);
});

logger.info("starting");

let app;
try {
  app = await bootstrap();
  logger.info("bootstrap_ok");
  setupGracefulShutdown(app);
} catch (err) {
  logger.error({ err }, "bootstrap_failed");
  process.exit(1);
}
