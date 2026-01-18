import cron from "node-cron";
import { dailyRecapCard } from "../bot/ui/cards.js";

export function startDailyRecap({ env, logger, positionStore, bot }) {
  const [hh, mm] = env.DAILY_RECAP_UTC.split(":").map((x) => Number(x));
  const expr = `${mm} ${hh} * * *`; // UTC
  const task = cron.schedule(
    expr,
    async () => {
      const day = positionStore.dayKeyUTC();
      const stamp = `${day}@${env.DAILY_RECAP_UTC}`;
      if (positionStore.getRecapStamp() === stamp) return;

      const all = positionStore.positions;
      const running = all.filter((p) => p.status === "RUNNING").length;

      // Prefer closeOutcome if available (PROFIT_FULL / PROFIT_PARTIAL / LOSS).
      // Fallback to legacy boolean `win` for backward compatibility.
      const isProfit = (p) => {
        if (p?.closeOutcome === "PROFIT_FULL" || p?.closeOutcome === "PROFIT_PARTIAL") return true;
        if (p?.closeOutcome === "LOSS") return false;
        return Boolean(p?.win);
      };

      const closedProfit = all.filter((p) => p.status === "CLOSED" && isProfit(p)).length;
      const closedLoss = all.filter((p) => p.status === "CLOSED" && !isProfit(p)).length;

      const signalsSent = positionStore.state.dailyCount?.[day] ?? 0;

      const recap = { day, signalsSent, running, closedProfit, closedLoss };

      const chatId =
        env.TEST_SIGNALS_CHAT_ID || (env.ALLOWED_GROUP_IDS?.[0] ?? env.TELEGRAM_CHAT_ID);

      if (chatId) {
        await bot.sendMessage(chatId, dailyRecapCard({ recap }), {
          parse_mode: "HTML",
          disable_web_page_preview: true
        });
      }

      positionStore.setRecapStamp(stamp);
      logger.info({ recap }, "Daily recap sent");
    },
    { timezone: "UTC" }
  );

  task.start();
  return () => task.stop();
}