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

    const results = await Promise.all(
      active.map((pos) => this.run(async () => {
        if (pos.status === "CLOSED") return null;

        let price = null;
        try {
          const p = await this.rest.premiumIndex({ symbol: pos.symbol });
          price = Number(p?.markPrice);
        } catch {
          price = Number(pos.levels.entryMid);
        }

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
        this.stateRepo.bumpOutcome(pos.closedAt, isWinOutcome(pos.closeOutcome));
      }

      const recipients = (Array.isArray(pos.notifyChatIds) && pos.notifyChatIds.length)
        ? pos.notifyChatIds
        : fallbackChatIdsToNotify;

      for (const chatId of recipients) {
        const replyOpts = {};
        if (pos.telegram && String(chatId) === String(pos.telegram.chatId) && pos.telegram.entryMessageId) {
          replyOpts.replyToMessageId = pos.telegram.entryMessageId;
          replyOpts.allow_sending_without_reply = true;
          if (pos.telegram.threadId != null) replyOpts.threadId = pos.telegram.threadId;
        }

        if (ev.event === "TP1") await this.sender.sendText(chatId, this.cards.tp1Card(pos), replyOpts);
        else if (ev.event === "TP2") await this.sender.sendText(chatId, this.cards.tp2Card(pos), replyOpts);
        else if (ev.event === "TP3") await this.sender.sendText(chatId, this.cards.tp3Card(pos), replyOpts);
        else if (ev.event === "SL") await this.sender.sendText(chatId, this.cards.slCard(pos), replyOpts);
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