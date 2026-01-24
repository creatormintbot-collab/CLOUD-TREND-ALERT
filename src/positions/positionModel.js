import { STATUS, ENTRY_CONFIRM_MODE, ENTRY_CONFIRM_DWELL_MS } from "../config/constants.js";

export function createPositionFromSignal(
  signal,
  { source = "AUTO", notifyChatIds = [], telegram = null } = {}
) {
  const id = `${signal.symbol}-${signal.tf}-${signal.candleCloseTime}-${signal.direction}`;
  return {
    id,
    source,
    notifyChatIds: (notifyChatIds || []).map(String),

    // Telegram threading metadata for TP/SL replies.
    // Shape:
    //   telegram: { entryMessageIds: { [chatId]: messageId } }
    telegram: telegram && typeof telegram === "object" ? telegram : null,

    symbol: signal.symbol,
    tf: signal.tf,
    direction: signal.direction,
    createdAt: Date.now(),
    candleCloseTime: signal.candleCloseTime,

    score: signal.score,
    macro: signal.macro,
    points: signal.points,
    levels: signal.levels,

    // 2-step entry confirmation (monitor-side)
    entryArmedAt: null,
    entryArmedPrice: null,
    entryConfirmMode: signal?.entryConfirmMode || ENTRY_CONFIRM_MODE,
    entryConfirmDwellMs: Number.isFinite(Number(signal?.entryConfirmDwellMs))
      ? Number(signal.entryConfirmDwellMs)
      : ENTRY_CONFIRM_DWELL_MS,

    filledAt: null,
    filledPrice: null,

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
