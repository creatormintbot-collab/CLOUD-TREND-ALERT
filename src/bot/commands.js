import { entryCard } from "./cards/entryCard.js";
import { buildOverlays } from "../charts/layout.js";
import { renderEntryChart } from "../charts/renderer.js";
import { createPositionFromSignal } from "../positions/positionModel.js";

function formatExplain({ symbol, diags, tfExplicit = null, rotationNote = false }) {
  const tfs = tfExplicit ? [tfExplicit] : (diags || []).map((d) => d.tf);

  const header = [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "🧠 SCAN EXPLAIN — RESULT",
    `🪙 Pair: ${symbol || "N/A"}`,
    `⏱ Checked: ${tfs.join(", ") || "N/A"}`,
    ""
  ];

  const lines = (diags || []).map((d) => {
    const score = Number(d.score || 0);
    const status = d.ok
      ? (d.blocked ? `BLOCKED (${d.blockReason})` : `OK (${score})`)
      : "NO SIGNAL";

    const issues = (d.issues || []).slice(0, 2).join(" ");
    return issues ? `${d.tf}: ${status} — ${issues}` : `${d.tf}: ${status}`;
  });

  const tips = [
    "",
    "Tips:",
    "• Wait for pullback closer to EMA21.",
    "• Prefer stronger ADX / higher ATR%.",
    "• If a timeframe is BLOCKED, it may be under gates (secondary, liquidity, or Ichimoku HTF)."
  ];

  const extra = rotationNote
    ? ["", "Note: /scan (no pair) checks one rotated pair at a time. Run /scan again to rotate."]
    : [];

  return [...header, ...lines, ...tips, ...extra].join("\n");
}

function ttlMsForTf(tf) {
  const t = String(tf || "").toLowerCase();
  if (t === "15m") return 6 * 60 * 60 * 1000;   // 6h
  if (t === "30m") return 12 * 60 * 60 * 1000;  // 12h
  if (t === "1h") return 24 * 60 * 60 * 1000;   // 24h
  if (t === "4h") return 24 * 60 * 60 * 1000;   // 24h
  return 24 * 60 * 60 * 1000;
}

function formatDuplicateNotice({ symbol, tf, pos }) {
  const status = pos?.status ? String(pos.status) : "ACTIVE";
  const createdAt = Number(pos?.createdAt ?? 0);
  const expiresAt = Number(pos?.expiresAt ?? 0);

  const now = Date.now();
  const minsLeft = (expiresAt && expiresAt > now) ? Math.max(0, Math.round((expiresAt - now) / 60000)) : null;

  const extra =
    minsLeft === null
      ? ""
      : `\n⏳ Expires In: ~${minsLeft} min`;

  return [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "⚠️ DUPLICATE PREVENTED",
    `🪙 Pair: ${symbol}`,
    `⏱ Timeframe: ${tf}`,
    `📌 Status: ${status}${extra}`,
    "",
    "Reason:",
    "• An existing signal is still active for this Pair + Timeframe.",
    "",
    "Tip:",
    "• Wait for it to fill/close, or scan a different pair/timeframe."
  ].join("\n");
}

export class Commands {
  constructor({ bot, sender, progressUi, pipeline, stateRepo, positionsRepo, signalsRepo, env }) {
    this.bot = bot;
    this.sender = sender;
    this.progressUi = progressUi;
    this.pipeline = pipeline;
    this.stateRepo = stateRepo;
    this.positionsRepo = positionsRepo;
    this.signalsRepo = signalsRepo;
    this.env = env;
  }

  bind() {
    this.bot.onText(/^\/help\b/i, async (msg) => {
      await this.sender.sendText(
        msg.chat.id,
        [
          "CLOUD TREND ALERT — Commands",
          "• /scan",
          "• /scan BTCUSDT",
          "• /scan BTCUSDT 15m",
          "• /scan BTCUSDT 30m",
          "• /scan BTCUSDT 1h",
          "• /scan BTCUSDT 4h",
          "• /top",
          "• /help"
        ].join("\n")
      );
    });

    this.bot.onText(/^\/top\b/i, async (msg) => {
      const ranked = await this.pipeline.topRanked();
      const lines = ranked.slice(0, 10).map((r, i) => `${i + 1}) ${r.symbol} ${r.tf} — ${Math.round(r.score)}`);
      await this.sender.sendText(msg.chat.id, ["Top Ranked (cached)", ...lines].join("\n"));
    });

    this.bot.onText(/^\/scan\b(.*)$/i, async (msg, match) => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id ?? 0;

      const raw = (match?.[1] || "").trim();
      const args = raw ? raw.split(/\s+/).filter(Boolean) : [];
      const symbolArg = args[0]?.toUpperCase();
      const tfArg = args[1]?.toLowerCase();

      // Validate timeframe (avoid wasted work / silent failures)
      const allowedTfs = (() => {
        const rawScan = this.env?.SCAN_TIMEFRAMES;
        const list = Array.isArray(rawScan)
          ? rawScan
          : String(rawScan || "").split(",").map((x) => x.trim()).filter(Boolean);

        const sec = String(this.env?.SECONDARY_TIMEFRAME || "").trim();
        if (sec && !list.includes(sec)) list.push(sec);

        // normalize
        return list.map((x) => String(x).toLowerCase());
      })();

      if (tfArg && !allowedTfs.includes(tfArg)) {
        await this.sender.sendText(chatId, [
          "CLOUD TREND ALERT",
          "━━━━━━━━━━━━━━━━━━",
          "⚠️ INVALID TIMEFRAME",
          `Provided: ${tfArg}`,
          `Allowed: ${allowedTfs.join(", ") || "N/A"}`,
          "",
          "Usage:",
          "• /scan BTCUSDT",
          "• /scan BTCUSDT 15m",
          "• /scan BTCUSDT 1h",
          `• /scan BTCUSDT ${String(this.env?.SECONDARY_TIMEFRAME || "4h")}`
        ].join("\n"));
        return;
      }

      // Count every /scan request (UTC day), regardless of outcome.
      try {
        if (typeof this.stateRepo.bumpScanRequest === "function") {
          this.stateRepo.bumpScanRequest();
          await this.stateRepo.flush();
        }
      } catch {}


      let symbolUsed = symbolArg || null;
      const rotationMode = !symbolArg;

      const startedAt = Date.now();
      let out = null;

      // Rotation mode keeps Progress UI (single edited message).
      if (rotationMode) {
        out = await this.progressUi.run({ chatId, userId }, async () => {
          const { symbol, res } = await this.pipeline.scanOneBest(chatId);
          symbolUsed = symbol;
          return res;
        });
      } else {
        // Targeted /scan (pair / pair+tf) skips Progress UI to avoid double messages
        // and focuses on a single explain/result response.
        try {
          let res = null;

          if (symbolArg && !tfArg) {
            symbolUsed = symbolArg;
            res = await this.pipeline.scanPair(symbolArg);
          } else {
            symbolUsed = symbolArg;
            res = await this.pipeline.scanPairTf(symbolArg, tfArg);

            // LOCKED 4h special rule:
            if (tfArg === this.env.SECONDARY_TIMEFRAME && symbolArg !== "ETHUSDT") {
              if (!res) res = null;
              else if ((res.score || 0) < this.env.SECONDARY_MIN_SCORE) res = null;
            }
          }

          const elapsedMs = Date.now() - startedAt;
          out = res ? { kind: "OK", result: res, elapsedMs } : { kind: "NO_SIGNAL", elapsedMs };
        } catch {
          out = { kind: "TIMEOUT", elapsedMs: Date.now() - startedAt };
        }
      }

      if (out.kind === "THROTTLED") {
        await this.signalsRepo.logScanThrottled({
          chatId,
          query: { symbol: symbolUsed || null, tf: tfArg || null, raw: raw || "" }
        });
        return;
      }

      if (out.kind === "LOCKED") return;

      if (out.kind === "NO_SIGNAL") {
        await this.signalsRepo.logScanNoSignal({
          chatId,
          query: { symbol: symbolUsed || null, tf: tfArg || null, raw: raw || "" },
          elapsedMs: out.elapsedMs
        });

        // explain (best-effort)
        try {
          if (symbolUsed) {
            if (symbolArg && tfArg) {
              const d = this.pipeline.explainPairTf(symbolUsed, tfArg);
              await this.sender.sendText(chatId, formatExplain({
                symbol: symbolUsed,
                diags: [d],
                tfExplicit: tfArg,
                rotationNote: false
              }));
            } else {
              const diags = this.pipeline.explainPair(symbolUsed);
              await this.sender.sendText(chatId, formatExplain({
                symbol: symbolUsed,
                diags,
                tfExplicit: null,
                rotationNote: rotationMode
              }));
            }
          }
        } catch {}

        return;
      }

      if (out.kind === "TIMEOUT") {
        await this.signalsRepo.logScanTimeout({
          chatId,
          query: { symbol: symbolUsed || null, tf: tfArg || null, raw: raw || "" },
          elapsedMs: out.elapsedMs
        });

        // Avoid silent failures for targeted scans (no Progress UI bubble here).
        await this.sender.sendText(chatId, [
          "Cloud Trend Alert",
          "⚠️ Scan timed out. Try again later."
        ].join("\n"));
        return;
      }

      if (out.kind !== "OK") return;

      const res = out.result;

      if (!res || !res.ok || res.score < 70 || res.scoreLabel === "NO SIGNAL") {
        await this.signalsRepo.logScanNoSignal({
          chatId,
          query: { symbol: symbolUsed || null, tf: tfArg || null, raw: raw || "" },
          elapsedMs: out.elapsedMs,
          meta: { reason: "SCORE_LT_70_OR_INVALID" }
        });

        try {
          if (symbolUsed) {
            const diags = this.pipeline.explainPair(symbolUsed);
            await this.sender.sendText(chatId, formatExplain({
              symbol: symbolUsed,
              diags,
              tfExplicit: null,
              rotationNote: rotationMode
            }));
          }
        } catch {}

        return;
      }


      // Prevent duplicate active signals (same Pair + Timeframe)
      try {
        const existing =
          (typeof this.positionsRepo.findActiveBySymbolTf === "function"
            ? this.positionsRepo.findActiveBySymbolTf(res.symbol, res.tf)
            : null) ||
          (Array.isArray(this.positionsRepo.listActive?.())
            ? this.positionsRepo.listActive().find((p) =>
                p &&
                p.status !== "CLOSED" &&
                p.status !== "EXPIRED" &&
                String(p.symbol || "").toUpperCase() === String(res.symbol || "").toUpperCase() &&
                String(p.tf || "").toLowerCase() === String(res.tf || "").toLowerCase()
              )
            : null);

        if (existing) {
          await this.signalsRepo.logScanThrottled({
            chatId,
            query: { symbol: symbolUsed || null, tf: res.tf || null, raw: raw || "" },
            meta: { reason: "DUPLICATE_ACTIVE" }
          });

          await this.sender.sendText(chatId, formatDuplicateNotice({
            symbol: res.symbol,
            tf: res.tf,
            pos: existing
          }));
          return;
        }
      } catch {}

      // chart FIRST (ENTRY only)
      const overlays = buildOverlays(res);
      const png = await renderEntryChart(res, overlays);
      await this.sender.sendPhoto(chatId, png);

      const entryMsg = await this.sender.sendText(chatId, entryCard(res));

      // counters
      try {
        if (typeof this.stateRepo.bumpScanSignalsSent === "function") this.stateRepo.bumpScanSignalsSent(res.tf);
        else this.stateRepo.bumpScan(res.tf);
        if (typeof this.stateRepo.markSentPairTf === "function") this.stateRepo.markSentPairTf(res.symbol, res.tf);
        await this.stateRepo.flush();
      } catch {}
      // log entry
      await this.signalsRepo.logEntry({
        source: "SCAN",
        signal: res,
        meta: { chatId: String(chatId), raw: raw || "" }
      });

      // create monitored position (notify only requester chat)
      const pos = createPositionFromSignal(res, {
        source: "SCAN",
        notifyChatIds: [String(chatId)],
        telegram: entryMsg?.message_id
          ? { entryMessageIds: { [String(chatId)]: entryMsg.message_id } }
          : null
      });

      // Entry lifecycle normalization (non-breaking, but prevents false TP/SL before entry is filled)
      pos.createdAt = pos.createdAt || Date.now();
      pos.expiresAt = pos.expiresAt || (pos.createdAt + ttlMsForTf(pos.tf));
      if (!pos.filledAt && !pos.hitTP1 && !pos.hitTP2 && !pos.hitTP3) {
        pos.status = "PENDING_ENTRY";
      }

      this.positionsRepo.upsert(pos);
      await this.positionsRepo.flush();
    });
  }
}