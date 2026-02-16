import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Sender } from "../src/bot/sender.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const sender = new Sender({
    bot: {},
    allowedGroupIds: [],
    allowedChannelIds: [],
    allowDm: true
  });

  if (!sender._isAllowed(12345)) {
    throw new Error("DM should be allowed when allowDm=true");
  }
  if (sender._isAllowed(-100123)) {
    throw new Error("Group/channel should be denied when allowlists are empty");
  }

  const monitorPath = path.join(__dirname, "..", "src", "positions", "monitor.js");
  const monitorSrc = await fs.readFile(monitorPath, "utf8");
  if (monitorSrc.includes("entryHitCardText")) {
    throw new Error("monitor.js still contains entryHitCardText fallback");
  }

  console.log("[sanity] OK");
}

main().catch((err) => {
  console.error("[sanity] FAIL:", err.message || err);
  process.exit(1);
});
