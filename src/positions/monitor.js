// File: src/positions/monitor.js
import { applyTP, applySL } from "./stateMachine.js";
import { isWinOutcome } from "./outcomes.js";
import { ENTRY_CONFIRM_MODE, ENTRY_CONFIRM_DWELL_MS } from "../config/constants.js";

function limitConcurrency(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

function ttlMsForTf(tf) {
  const t = String(tf || "").toLowerCase();
  if (t === "15m") return 6 * 60 * 60 * 1000;   // 6h
  if (t === "30m") return 12 * 60 * 60 * 1000;  // 12h
  if (t === "1h") return 24 * 60 * 60 * 1000;   // 24h
  if (t === "4h") return 24 * 60 * 60 * 1000;   // 24h
  return 24 * 60 * 60 * 1000;
}

function isFilled(pos) {
  if (!pos) return false;

  const fa = Number(pos.filledAt);
  if (Number.isFinite(fa) && fa > 0) return true;

  // Backward-compatible: older positions may have RUNNING or TP flags without filledAt
  if (pos.hitTP1 || pos.hitTP2 || pos.hitTP3) return true;
  if (String(pos.status || "").toUpperCase() === "RUNNING") return true;

  return false;
}

function inEntryZone(pos, price) {
  const p = Number(price);
  const low = Number(pos?.levels?.entryLow);
  const high = Number(pos?.levels?.entryHigh);

  if (!Number.isFinite(p) || !Number.isFinite(low) || !Number.isFinite(high)) return false;

  const lo = Math.min(low, high);
  const hi = Math.max(low, high);
  return p >= lo && p <= hi;
}

function entryHitCardText(pos, price) {
  const dir = String(pos?.direction || pos?.side || "").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  const dot = dir === "LONG" ? "🟢" : "🔴";

  const tf = pos?.tf || "N/A";
  const sym = pos?.symbol || "N/A";
  const pb = String(pos?.playbook || (String(tf).toLowerCase() === "4h" ? "SWING" : "INTRADAY")).toUpperCase();
  const mode = pb === "SWING" ? "Swing" : "Intraday";

  const low = pos?.levels?.entryLow;
  const high = pos?.levels?.entryHigh;
  const mid = pos?.levels?.entryMid;

  const sl = (pos?.slCurrent ?? pos?.levels?.sl);

  const fmt = (v) => {
    if (v === null || v === undefined) return "N/A";
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    if (Math.abs(n) >= 1000) return n.toFixed(2);
    if (Math.abs(n) >= 1) return n.toFixed(4);
    return n.toFixed(4);
  };

  return [
    "CLOUD TREND ALERT",
    "────────────────────────────────",
    `✅ ENTRY CONFIRMED — ${dot} ${dir}`,
    `🌕 Pair: ${sym}`,
    `⏱ Signal TF: ${tf}`,
    `🧭 Mode: ${mode}`,
    "",
    "🎯 Entry Zone:",
    `${fmt(low)} – ${fmt(high)}`,
    "⚖️ Mid Entry:",
    `${fmt(mid)}`,
    "",
    "📌 Mark Price:",
    `${fmt(price)}`,
    "",
    "🛑 Stop Loss:",
    `${fmt(sl)}`,
    "",
    "⚠️ Not Financial Advice",
  ].join("\n");
}

export class Monitor {
  constructor({ rest, positionsRepo, stateRepo, signalsRepo, sender, cards }) {
    this.rest = rest;
    this.positionsRepo = positionsRepo;
    this.stateRepo = stateRepo;
    this.signalsRepo = signalsRepo;
    this.sender = sender;
    this.cards = cards;
    this.run = limitConcurrency(6);
  }

  async tick(fallbackChatIdsToNotify = []) {
    const active = this.positionsRepo.listActive();
    if (!active.length) return;

    const nowMs = Date.now();

    const results = await Promise.all(
      active.map((pos) => this.run(async () => {
        if (!pos || pos.status === "CLOSED" || pos.status === "EXPIRED") return null;        let price = null;

        // Prefer mark price (futures) with premiumIndex fallback.
        // IMPORTANT: do NOT fallback to entryMid when price fetch fails.
        try {
          if (this.rest?.markPrice) {
            try {
              const p = await this.rest.markPrice({ symbol: pos.symbol });
              price = Number(p?.markPrice ?? p?.price);
            } catch {
              const p = await this.rest.markPrice(pos.symbol);
              price = Number(p?.markPrice ?? p?.price);
            }
          }
        } catch {
          // ignore
        }

        if (!Number.isFinite(price)) {
          try {
            const p = await this.rest.premiumIndex({ symbol: pos.symbol });
            price = Number(p?.markPrice ?? p?.indexPrice ?? p?.price);
          } catch {
            // ignore
          }
        }

        // --- ENTRY lifecycle: pending -> filled or expired ---
        const filled = isFilled(pos);

        // If a position is already FILLED (e.g. restored after restart) but ENTRY CONFIRMED was never sent,
        // emit a one-time FILLED event so the notifier can broadcast to all recipients.
        if (filled && !pos.entryHitNotifiedAt && !pos.entryHitNotified) {
          const pForEntry = Number.isFinite(Number(price))
            ? Number(price)
            : (
                Number.isFinite(Number(pos?.filledPrice)) ? Number(pos.filledPrice)
                : (Number.isFinite(Number(pos?.levels?.entryMid)) ? Number(pos.levels.entryMid) : null)
              );
          // Ensure entryHitAt exists for UTC-day metrics (status/recap)
          pos.entryHitAt = pos.entryHitAt || Number(pos.filledAt) || nowMs;
          return { pos, event: "FILLED", price: pForEntry };
        }

        if (!filled) {
          // best-effort timestamps (non-breaking)
          const createdAt = Number(pos.createdAt ?? pos.created ?? pos.ts ?? pos.openedAt ?? 0) || nowMs;
          if (!pos.createdAt) pos.createdAt = createdAt;

          const exp = Number(pos.expiresAt ?? 0) || (createdAt + ttlMsForTf(pos.tf));
          pos.expiresAt = exp;

          if (nowMs >= exp) {
            pos.status = "EXPIRED";
            pos.expiredAt = nowMs;
            pos.closedAt = pos.closedAt || nowMs;
            pos.closeOutcome = pos.closeOutcome || "EXPIRED";
            return { pos, event: "EXPIRED", price };
          }

          const zoneHit = inEntryZone(pos, price);

          if (zoneHit) {
            const mode = String(pos?.entryConfirmMode || ENTRY_CONFIRM_MODE).toUpperCase();
            const dwellMs = Number.isFinite(Number(pos?.entryConfirmDwellMs))
              ? Number(pos.entryConfirmDwellMs)
              : ENTRY_CONFIRM_DWELL_MS;

            // Step 1: Setup touched the zone -> ARM (persist state; no chat notify).
            if (!pos.entryArmedAt) {
              pos.entryArmedAt = nowMs;
              pos.entryArmedPrice = Number(price);
              pos.status = "PENDING_ENTRY";
              return { pos, event: "ARMED", price };
            }

            // Require the price to persist inside the zone for a minimum dwell time (anti-wick).
            if (dwellMs > 0 && (nowMs - Number(pos.entryArmedAt)) < dwellMs) {
              pos.status = "PENDING_ENTRY";
              return null;
            }

            // Step 2: Trigger confirmation (default MID_CROSS).
            const mid = Number(pos?.levels?.entryMid);
            const dir = String(pos?.direction || "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";

            let triggerOk = true;
            if (mode === "MID_CROSS") {
              if (!Number.isFinite(mid) || !Number.isFinite(Number(price))) triggerOk = false;
              else triggerOk = dir === "LONG" ? Number(price) >= mid : Number(price) <= mid;
            }

            if (triggerOk) {
              pos.filledAt = nowMs;
              pos.entryHitAt = pos.entryHitAt || nowMs;
              pos.filledPrice = Number(price);
              pos.openedAt = pos.openedAt || nowMs;
              pos.status = "RUNNING";
              return { pos, event: "FILLED", price };
            }
          }

          pos.status = "PENDING_ENTRY";
          return null;
        }

        // --- Active trade monitoring (only after FILLED) ---
        if (!Number.isFinite(Number(price))) return null;

        const tp = applyTP(pos, price);
        if (tp.changed) return { pos, event: tp.event, price };

        const sl = applySL(pos, price);
        if (sl.changed) return { pos, event: sl.event, price };

        return null;
      }))
    );

    const events = results.filter(Boolean);

    for (const ev of events) {
      const pos = ev.pos;

      if (pos.status === "CLOSED" && pos.closedAt) {
        // WIN/LOSE classification handled in outcomes.js (LOCKED rules)
        this.stateRepo.bumpOutcome(pos.closedAt, isWinOutcome(pos.closeOutcome));
      }

      const recipientsRaw = (Array.isArray(pos.notifyChatIds) && pos.notifyChatIds.length)
        ? pos.notifyChatIds
        : fallbackChatIdsToNotify;

      // Normalize + dedupe recipients to prevent partial delivery issues on broadcast.
      const recipients = Array.from(new Set((recipientsRaw || []).map(String)));
      if (!Array.isArray(pos.notifyChatIds) || !pos.notifyChatIds.length) {
        pos.notifyChatIds = recipients;
      }

      // Precompute ENTRY CONFIRMED payload once, then broadcast to all recipients before setting notified flags.
      const shouldSendEntry =
        ev.event === "FILLED" && !pos.entryHitNotifiedAt && !pos.entryHitNotified;

      const entryText = shouldSendEntry
        ? (
            (this.cards && typeof this.cards.entryHitCard === "function")
              ? this.cards.entryHitCard(pos, ev.price)
              : entryHitCardText(pos, ev.price)
          )
        : null;

      for (const chatId of recipients) {
        const replyTo =
          pos?.telegram?.entryMessageIds?.[String(chatId)] ??
          pos?.telegram?.entryMessageId ??
          null;

        const send = replyTo
          ? (text) => this.sender.sendTextReply(chatId, replyTo, text)
          : (text) => this.sender.sendText(chatId, text);

        if (ev.event === "TP1") await send(this.cards.tp1Card(pos));
        else if (ev.event === "TP2") await send(this.cards.tp2Card(pos));
        else if (ev.event === "TP3") await send(this.cards.tp3Card(pos));
        else if (ev.event === "SL") await send(this.cards.slCard(pos));
        else if (ev.event === "FILLED") {
          if (entryText) await send(entryText);
        }
        // EXPIRED is tracked in logs/state, but not sent to chat by default.
      }

      // Mark ENTRY CONFIRMED as notified only AFTER broadcasting to all notifyChatIds.
      if (entryText && recipients.length) {
        pos.entryHitNotifiedAt = Number(pos.filledAt) || Date.now();
        pos.entryHitAt = pos.entryHitAt || pos.entryHitNotifiedAt;
        pos.entryHitNotified = true;
      }

      const originSource = String(pos.source || "AUTO").toUpperCase();
      await this.signalsRepo.logLifecycle({
        source: "MONITOR",
        pos,
        event: ev.event,
        price: ev.price,
        meta: { notifyChatIds: recipients.map(String), originSource }
      });

      this.positionsRepo.upsert(pos);
    }

    await Promise.all([this.positionsRepo.flush(), this.stateRepo.flush(), this.signalsRepo.flush()]);
  }
}
