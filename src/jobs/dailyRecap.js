import cron from "node-cron";
import { dailyRecapCard } from "../bot/ui/cards.js";

// =============================
// DAILY RECAP (UTC) — hardened guards
// =============================

function parseBool(v, fallback = true) {
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function parseHHMM(v) {
  if (v === undefined || v === null) return null;
  const raw = String(v).trim();
  const m = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/); // HH:MM (00-23):(00-59)
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return { hh, mm, raw: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` };
}

function parseChatIds(v) {
  if (v === undefined || v === null) return [];
  // support: string "-100..,-52.." OR array ["-100..", ...]
  const items = Array.isArray(v) ? v : String(v).split(",");
  return items
    .map((x) => String(x).trim())
    .filter(Boolean)
    .filter((x) => /^-?\d+$/.test(x));
}

function hasValidBotToken(token) {
  if (!token) return false;
  const t = String(token).trim();
  // Telegram bot token usually contains ':' and has length > 10
  return t.length >= 10 && t.includes(":");
}

function pickTargetChatId(env) {
  // prefer explicit test chat id, else first allowed group, else TELEGRAM_CHAT_ID
  const test = parseChatIds(env?.TEST_SIGNALS_CHAT_ID);
  if (test.length) return test[0];

  const allowed = parseChatIds(env?.ALLOWED_GROUP_IDS);
  if (allowed.length) return allowed[0];

  const legacy = parseChatIds(env?.TELEGRAM_CHAT_ID);
  if (legacy.length) return legacy[0];

  return null;
}

export function startDailyRecap({ env, logger, positionStore, bot }) {
  // MINIMAL GUARD: if daily recap is disabled or time is missing, do not crash the whole app.
  const enabled = parseBool(env?.DAILY_RECAP, true);
  if (!enabled) {
    logger?.info?.("Daily recap disabled (DAILY_RECAP=0)");
    return () => {};
  }

  const hhmm = parseHHMM(env?.DAILY_RECAP_UTC);
  if (!hhmm) {
    logger?.warn?.(
      { DAILY_RECAP_UTC: env?.DAILY_RECAP_UTC },
      "Daily recap not started: missing/invalid DAILY_RECAP_UTC (expected HH:MM)"
    );
    return () => {};
  }

  // EXTRA GUARD: never attempt to send Telegram if token missing/invalid.
  // This prevents 401 crash loops when PM2 restarts with bad env.
  if (!hasValidBotToken(env?.BOT_TOKEN ?? process.env.BOT_TOKEN)) {
    logger?.warn?.("Daily recap not started: BOT_TOKEN missing/invalid");
    return () => {};
  }

  // Hard guard: required deps
  if (!positionStore || typeof positionStore.dayKeyUTC !== "function") {
    logger?.warn?.("Daily recap not started: positionStore.dayKeyUTC() not available");
    return () => {};
  }
  if (!bot || typeof bot.sendMessage !== "function") {
    logger?.warn?.("Daily recap not started: bot.sendMessage() not available");
    return () => {};
  }

  const expr = `${hhmm.mm} ${hhmm.hh} * * *`; // UTC

  const task = cron.schedule(
    expr,
    async () => {
      try {
        const day = positionStore.dayKeyUTC();
        const stamp = `${day}@${hhmm.raw}`;
        // ensure once per UTC day (uses persisted state if your store saves it)
        if (typeof positionStore.getRecapStamp === "function" && positionStore.getRecapStamp() === stamp) return;

        const all = Array.isArray(positionStore.positions) ? positionStore.positions : [];
        const running = all.filter((p) => p?.status === "RUNNING").length;

        // Prefer closeOutcome if available (PROFIT_FULL / PROFIT_PARTIAL / LOSS).
        // Fallback to legacy boolean `win` for backward compatibility.
        const isProfit = (p) => {
          if (p?.closeOutcome === "PROFIT_FULL" || p?.closeOutcome === "PROFIT_PARTIAL") return true;
          if (p?.closeOutcome === "LOSS") return false;
          return Boolean(p?.win);
        };

        const closedProfit = all.filter((p) => p?.status === "CLOSED" && isProfit(p)).length;
        const closedLoss = all.filter((p) => p?.status === "CLOSED" && !isProfit(p)).length;

        const signalsSent = positionStore?.state?.dailyCount?.[day] ?? 0;

        const recap = { day, signalsSent, running, closedProfit, closedLoss };

        const chatId = pickTargetChatId(env);
        if (!chatId) {
          logger?.warn?.("Daily recap skipped: no valid target chatId (TEST_SIGNALS_CHAT_ID / ALLOWED_GROUP_IDS / TELEGRAM_CHAT_ID)");
          return;
        }

        await bot.sendMessage(chatId, dailyRecapCard({ recap }), {
          parse_mode: "HTML",
          disable_web_page_preview: true
        });

        if (typeof positionStore.setRecapStamp === "function") positionStore.setRecapStamp(stamp);
        logger?.info?.({ recap, chatId }, "Daily recap sent");
      } catch (e) {
        logger?.error?.({ err: String(e) }, "Daily recap error (guarded)");
      }
    },
    { timezone: "UTC" }
  );

  task.start();
  return () => task.stop();
}