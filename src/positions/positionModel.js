import { STATUS } from "../config/constants.js";

export function createPositionFromSignal(signal, { source = "AUTO", notifyChatIds = [], telegram = null } = {}) {
  const id = `${signal.symbol}-${signal.tf}-${signal.candleCloseTime}-${signal.direction}`;
  return {
    id,
    source,
    notifyChatIds: (notifyChatIds || []).map(String),

    // Used for reply-to threading (optional).
    telegram: telegram
      ? {
        chatId: telegram.chatId != null ? String(telegram.chatId) : null,
        threadId: telegram.threadId != null ? telegram.threadId : null,
        entryMessageId: telegram.entryMessageId != null ? telegram.entryMessageId : null
      }
      : { chatId: null, threadId: null, entryMessageId: null },

    symbol: signal.symbol,
    tf: signal.tf,
    direction: signal.direction,
    createdAt: Date.now(),
    candleCloseTime: signal.candleCloseTime,

    score: signal.score,
    macro: signal.macro,
    points: signal.points,
    levels: signal.levels,

    status: STATUS.ENTRY,
    closeOutcome: null,

    hitTP1: false,
    hitTP2: false,
    hitTP3: false,

    slInitial: signal.levels.sl,
    slCurrent: signal.levels.sl,
    slMode: "INITIAL",

    closedAt: null
  };
}
