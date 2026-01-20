import "dotenv/config";
import { bootstrap } from "./lifecycle/bootstrap.js";
import { setupGracefulShutdown } from "./lifecycle/gracefulShutdown.js";

const app = await bootstrap();
setupGracefulShutdown(app);
