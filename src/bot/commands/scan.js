import { isValidTF } from "../../config/timeframes.js";
import { editProgress, sendProgress } from "../ui/progress.js";
import { noSignalCard, entryCard } from "../ui/cards.js";

// Anti-double execution guard (helps if /scan handler is registered twice)
const _inflightByChat = new Set();

function normalizeSymbol(input) {
  if (!input) return null;
  let s = String(input).trim();
  if (!s) return null;

  // Remove common separators and suffixes
  s = s.replace(/\s+/g, "");
  s = s.replace(/[\/_\-:]/g, "");
  // Some users paste TradingView symbols like BINANCE:ETHUSDT.P
  s = s.replace(/^.*:/, "");
  s = s.replace(/\.(P|PERP)$/i, "");
  s = s.toUpperCase();

  // If user only gives base asset (e.g., ETH), assume USDT
  if (!s.endsWith("USDT")) s = `${s}USDT`;

  return s;
}

function normalizeTF(input) {
  if (!input) return null;
  let tf = String(input).trim();
  if (!tf) return null;

  tf = tf.toLowerCase();

  // Common aliases
  const map = {
    "15": "15m",
    "15min": "15m",
    "15mins": "15m",
    "30": "30m",
    "30min": "30m",
    "30mins": "30m",
    "60": "1h",
    "60m": "1h",
    "1hr": "1h",
    "1hour": "1h",
    "1h": "1h",
    "240": "4h",
    "240m": "4h",
    "4h": "4h"
  };

  tf = map[tf] ?? tf;

  // Must match canonical list
  if (!isValidTF(tf)) return null;
  return tf;
}

export async function handleScanCommand({
  bot,
  chatId,
  args,
  scanner,
  logger
}) {
  // If the same chat triggers /scan twice (e.g., duplicate handler), ignore the second call.
  if (_inflightByChat.has(chatId)) return;
  _inflightByChat.add(chatId);

  const symbol = normalizeSymbol(args?.[0]);
  const tf = normalizeTF(args?.[1]);

  try {
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

    logger.info(
      { manualRequest: true, symbol: res.signal.symbol, tf: res.signal.timeframe },
      "On-demand SIGNAL sent"
    );
  } finally {
    _inflightByChat.delete(chatId);
  }
}