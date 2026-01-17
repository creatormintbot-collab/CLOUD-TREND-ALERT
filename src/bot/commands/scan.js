import { isValidTF } from "../../config/timeframes.js";
import { editProgress, sendProgress } from "../ui/progress.js";
import { noSignalCard, entryCard } from "../ui/cards.js";

export async function handleScanCommand({
  bot,
  chatId,
  args,
  scanner,
  logger
}) {
  const symbolArg = args?.[0]?.toUpperCase();
  const tfArg = args?.[1];

  const tf = tfArg && isValidTF(tfArg) ? tfArg : null;
  const symbol = symbolArg ? symbolArg.replace("/", "").replace("-", "") : null;

  const msgId = await sendProgress(bot, chatId, "🧠 Booting AI Core… 0%");

  await editProgress(bot, chatId, msgId, "🤖 Finalizing data… 90%");

  const res = await scanner.scanOnDemand({ symbol, timeframe: tf, chatId });

  await editProgress(bot, chatId, msgId, "✅ AI Futures Signal Generated! 100%");

  if (!res.ok) {
    await bot.sendMessage(chatId, noSignalCard({ symbol, tf, reasons: res.reasons }), {
      parse_mode: "HTML",
      disable_web_page_preview: true
    });
    logger.info({ manualRequest: true, symbol, tf, reasons: res.reasons }, "On-demand NO SIGNAL");
    return;
  }

  await bot.sendMessage(chatId, entryCard({ signal: res.signal }), {
    parse_mode: "HTML",
    disable_web_page_preview: true
  });

  logger.info({ manualRequest: true, symbol: res.signal.symbol, tf: res.signal.timeframe }, "On-demand SIGNAL sent");
}
