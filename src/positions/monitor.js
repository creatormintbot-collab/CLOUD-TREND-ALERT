import { applyTP, applySL } from "./stateMachine.js";
import { isWinOutcome } from "./outcomes.js";

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
  // Backward-compatible: some older positions may not have filledAt but are already RUNNING / have TP hits.
  if (!pos) return false;
  if (Number.isFinite(Number(pos.filledAt)) && Number(pos.filledAt) > 0) return true;
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

function isWinLocked(pos) {
  // LOCKED: WIN = ≥TP1 (including SL after TP1/TP2)
  if (!pos) return false;
  if (pos.hitTP1 || pos.hitTP2 || pos.hitTP3) return true;

  const o = String(pos.closeOutcome || "").toUpperCase();
  if (o === "PROFIT_FULL") return true;
  if (o === "STOP_LOSS_AFTER_TP1") return true;
  if (o === "STOP_LOSS_AFTER_TP2") return true;
  return false;
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
        if (!pos || pos.status === "CLOSED" || pos.status === "EXPIRED") return null;

        let price = null;
        try {
          const p = await this.rest.premiumIndex({ symbol: pos.symbol });
          price = Number(p?.markPrice);
        } catch {
          price = Number(pos?.levels?.entryMid);
        }

        // --- ENTRY lifecycle: pending -> filled or expired ---
        const filled = isFilled(pos);

        if (!filled) {
          // ensure createdAt/expiresAt exist (best-effort, non-breaking)
          const createdAt = Number(pos.createdAt ?? pos.created ?? pos.ts ?? pos.openedAt ?? 0) || nowMs;
          if (!pos.createdAt) pos.createdAt = createdAt;

          const exp = Number(pos.expiresAt ?? 0) || (createdAt + ttlMsForTf(pos.tf));
          pos.expiresAt = exp;

          if (nowMs >= exp) {
            pos.status = "EXPIRED";
            pos.expiredAt = nowMs;
            // keep closedAt for audit but do NOT count as WIN/LOSE
            pos.closedAt = pos.closedAt || nowMs;
            pos.closeOutcome = pos.closeOutcome || "EXPIRED";
            return { pos, event: "EXPIRED", price };
          }

          if (inEntryZone(pos, price)) {
            pos.filledAt = nowMs;
            pos.openedAt = pos.openedAt || nowMs;
            pos.status = "RUNNING";
            return { pos, event: "FILLED", price };
          }

          // still waiting
          pos.status = "PENDING_ENTRY";
          return null;
        }

        // --- Active trade monitoring ---
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
        const win = isWinLocked(pos) || isWinOutcome(pos.closeOutcome);
        this.stateRepo.bumpOutcome(pos.closedAt, win);
      }

      const recipients = (Array.isArray(pos.notifyChatIds) && pos.notifyChatIds.length)
        ? pos.notifyChatIds
        : fallbackChatIdsToNotify;

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
        // FILLED / EXPIRED are tracked but do not spam chat by default.
      }

      await this.signalsRepo.logLifecycle({
        source: pos.source || "AUTO",
        pos,
        event: ev.event,
        price: ev.price,
        meta: { notifyChatIds: recipients.map(String) }
      });

      this.positionsRepo.upsert(pos);
    }

    await Promise.all([this.positionsRepo.flush(), this.stateRepo.flush(), this.signalsRepo.flush()]);
  }
}
