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
    "• If 4h is valid but BLOCKED, it is under the secondary filter."
  ];

  const extra = rotationNote
    ? ["", "Note: /scan (no pair) checks one rotated pair at a time. Run /scan again to rotate."]
    : [];

  return [...header, ...lines, ...tips, ...extra].join("\n");
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

      let symbolUsed = symbolArg || null;
      // LOCKED: /scan (no pair) is batch scan (Top50→30→10→Top 1–3). No rotation note.
      const rotationMode = false;

      const out = await this.progressUi.run({ chatId, userId }, async () => {
        if (!symbolArg) {
          // /scan (no pair) — batch scan
          symbolUsed = null;
          return this.pipeline.scanBatchBest({ limit: 3 });
        }

        if (symbolArg && !tfArg) {
          symbolUsed = symbolArg;
          return this.pipeline.scanPair(symbolArg);
        }

        symbolUsed = symbolArg;
        const res = await this.pipeline.scanPairTf(symbolArg, tfArg);

        // LOCKED 4h special rule:
        if (tfArg === this.env.SECONDARY_TIMEFRAME && symbolArg !== "ETHUSDT") {
          if (!res) return null;
          if ((res.score || 0) < this.env.SECONDARY_MIN_SCORE) return null;
        }

        return res;
      });

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
        return;
      }

      if (out.kind !== "OK") return;

      const res = out.result;

      // ==============================
      // /scan (no pair) — BATCH OUTPUT
      // ==============================
      if (res && res.kind === "BATCH") {
        const signals = Array.isArray(res.signals) ? res.signals : [];

        // Keep existing maturity: only "send entry" for valid + minimum quality.
        const valid = signals.filter((r) => r && r.ok && (r.score || 0) >= 70 && r.scoreLabel !== "NO SIGNAL");

        // If we have at least one valid signal, publish them (Top 1–3).
        if (valid.length) {
          for (const sig of valid) {
            try {
              const overlays = buildOverlays(sig);
              const png = await renderEntryChart(sig, overlays);
              await this.sender.sendPhoto(chatId, png);

              await this.sender.sendText(chatId, entryCard(sig));

              // counters
              this.stateRepo.bumpScan(sig.tf);
              await this.stateRepo.flush();

              // log entry
              await this.signalsRepo.logEntry({
                source: "SCAN",
                signal: sig,
                meta: { chatId: String(chatId), raw: raw || "" }
              });

              // create monitored position (notify only requester chat)
              const pos = createPositionFromSignal(sig, { source: "SCAN", notifyChatIds: [String(chatId)] });
              this.positionsRepo.upsert(pos);
              await this.positionsRepo.flush();
            } catch {}
          }

          return;
        }

        // No valid signals in batch — still return best-effort top picks (explain)
        await this.signalsRepo.logScanNoSignal({
          chatId,
          query: { symbol: null, tf: null, raw: raw || "" },
          elapsedMs: out.elapsedMs,
          meta: {
            reason: "BATCH_NO_SIGNAL",
            pipeline: res.meta || null
          }
        });

        const meta = res.meta || {};
        await this.sender.sendText(
          chatId,
          [
            "CLOUD TREND ALERT",
            "━━━━━━━━━━━━━━━━━━",
            "\ud83e\udde0 SCAN — TOP PICKS (No high-confidence signal)",
            `Universe: ${meta.universe ?? "N/A"} | Scanned: ${meta.top50 ?? "N/A"} | Prefilter: ${meta.top30 ?? "N/A"} | Deep: ${meta.top10 ?? "N/A"}`,
            "",
            "Showing explain for best candidates:"
          ].join("\n")
        );

        const picks = Array.isArray(res.candidates) ? res.candidates.slice(0, 3) : [];
        for (const sym of picks) {
          try {
            const diags = this.pipeline.explainPair(sym);
            await this.sender.sendText(chatId, formatExplain({
              symbol: sym,
              diags,
              tfExplicit: null,
              rotationNote: false
            }));
          } catch {}
        }

        return;
      }

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

      // chart FIRST (ENTRY only)
      const overlays = buildOverlays(res);
      const png = await renderEntryChart(res, overlays);
      await this.sender.sendPhoto(chatId, png);

      await this.sender.sendText(chatId, entryCard(res));

      // counters
      this.stateRepo.bumpScan(res.tf);
      await this.stateRepo.flush();

      // log entry
      await this.signalsRepo.logEntry({
        source: "SCAN",
        signal: res,
        meta: { chatId: String(chatId), raw: raw || "" }
      });

      // create monitored position (notify only requester chat)
      const pos = createPositionFromSignal(res, { source: "SCAN", notifyChatIds: [String(chatId)] });
      this.positionsRepo.upsert(pos);
      await this.positionsRepo.flush();
    });
  }
}