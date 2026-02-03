export function isWinOutcome(outcome) {
  const o = String(outcome || "").toUpperCase();
  if (!o) return false;

  // Strict rule: SL BEFORE TP1 is a loss.
  if (o.includes("STOP_LOSS_BEFORE_TP1") || o.includes("SL_BEFORE_TP1") || o.includes("BEFORE_TP1")) return false;

  // Any realized profit / TP hit counts as a WIN (≥TP1)
  if (o.startsWith("PROFIT")) return true;
  if (o.includes("TP1") || o.includes("TP2") || o.includes("TP3")) return true;

  // SL after taking profit counts as WIN (giveback).
  if (o.includes("STOP_LOSS_AFTER_TP") || o.includes("SL_AFTER_TP")) return true;

  return false;
}

export function getTpHitMax(pos) {
  if (!pos) return 0;
  const v = Number(pos.tpHitMax);
  if (Number.isFinite(v) && v >= 0) return v;
  if (pos.hitTP3) return 3;
  if (pos.hitTP2) return 2;
  if (pos.hitTP1) return 1;
  return 0;
}

export function isGiveback(pos) {
  if (!pos) return false;
  const tp = getTpHitMax(pos);
  const sl = Boolean(pos.slHit) || String(pos.closeOutcome || '').toUpperCase().includes('STOP_LOSS');
  return sl && tp >= 1 && String(pos.status || '').toUpperCase() === 'CLOSED';
}

export function isDirectSL(pos) {
  if (!pos) return false;
  const tp = getTpHitMax(pos);
  const sl = Boolean(pos.slHit) || String(pos.closeOutcome || '').toUpperCase().includes('STOP_LOSS');
  return sl && tp === 0 && String(pos.status || '').toUpperCase() === 'CLOSED';
}

export function getOutcomeBucket(pos) {
  const tp = getTpHitMax(pos);
  if (tp >= 3) return 'TP3';
  if (tp === 2) return 'TP2';
  if (tp === 1) return 'TP1';
  if (isDirectSL(pos)) return 'SL';
  return 'UNKNOWN';
}

function normUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function dayKeyFromEvent(ev) {
  const raw = String(ev?.dayUTC || "").trim();
  if (raw) return raw;
  const ts = Date.parse(ev?.ts || "");
  if (!Number.isFinite(ts)) return "";
  return new Date(ts).toISOString().slice(0, 10);
}

function tpLevelFromEvent(ev) {
  const evt = normUpper(ev?.event);
  if (evt === "TP1") return 1;
  if (evt === "TP2") return 2;
  if (evt === "TP3") return 3;
  return 0;
}

function isSlLifecycleEvent(ev) {
  const evt = normUpper(ev?.event);
  const status = normUpper(ev?.status);
  if (status !== "CLOSED") return false;
  // SL loss classification relies on lifecycle events; closeReason may be null.
  if (evt !== "SL" && evt !== "STOP_LOSS" && evt !== "STOPLOSS") return false;
  const typeRaw = String(ev?.type || "").trim();
  const type = normUpper(typeRaw);
  return !typeRaw || type === "LIFECYCLE" || type === "TP";
}

function isExpiredLifecycleEvent(ev) {
  const evt = normUpper(ev?.event);
  const status = normUpper(ev?.status);
  return evt === "EXPIRED" || status === "EXPIRED";
}

function isEntryLifecycleEvent(ev) {
  const evt = normUpper(ev?.event);
  if (evt !== "FILLED") return false;
  const typeRaw = String(ev?.type || "").trim();
  const type = normUpper(typeRaw);
  return !typeRaw || type === "LIFECYCLE";
}

export function buildPositionStateMapFromEvents(events = []) {
  const rows = Array.isArray(events) ? events : [];
  const map = {};

  for (const ev of rows) {
    if (!ev) continue;
    const id = String(ev.positionId || "").trim();
    if (!id) continue;

    if (!map[id]) {
      map[id] = {
        symbol: ev?.symbol || "",
        positionId: id,
        tpLevel: 0,
        hasEntry: false,
        expiredNoEntry: false,
        closedBySL: false,
        closedByOther: false,
        closedDayUTC: ""
      };
    }

    const state = map[id];
    if (!state.symbol && ev?.symbol) state.symbol = ev.symbol;

    const hit = ev?.hit || {};
    const hitLevel = hit.tp3 ? 3 : (hit.tp2 ? 2 : (hit.tp1 ? 1 : 0));
    if (hitLevel > 0) state.tpLevel = Math.max(state.tpLevel, hitLevel);

    const dayUTC = dayKeyFromEvent(ev);
    const tpLevel = tpLevelFromEvent(ev);
    if (tpLevel > 0) state.tpLevel = Math.max(state.tpLevel, tpLevel);

    if (isEntryLifecycleEvent(ev)) state.hasEntry = true;

    if (isSlLifecycleEvent(ev)) {
      state.closedBySL = true;
      if (dayUTC) state.closedDayUTC = dayUTC;
      continue;
    }

    if (isExpiredLifecycleEvent(ev)) {
      state.expiredNoEntry = true;
      if (dayUTC) state.closedDayUTC = dayUTC;
      continue;
    }

    const status = normUpper(ev?.status);
    if (status === "CLOSED") {
      state.closedByOther = true;
      if (dayUTC) state.closedDayUTC = dayUTC;
    }
  }

  return map;
}

export function deriveOutcomeForState(state) {
  if (!state) {
    return { outcome: null, labelForList: "", countsTowardTradingClosed: false };
  }
  if (state.expiredNoEntry) {
    return { outcome: "EXPIRED", labelForList: "⏳ EXPIRED (No Entry)", countsTowardTradingClosed: false };
  }
  if (state.closedBySL) {
    if (state.tpLevel >= 1) {
      return { outcome: "WIN", labelForList: "🟡 PARTIAL (SL After TP)", countsTowardTradingClosed: true };
    }
    return { outcome: "LOSS", labelForList: "🛑 LOSS (Direct SL)", countsTowardTradingClosed: true };
  }
  if (state.closedByOther || state.closedDayUTC) {
    if (state.tpLevel >= 1) {
      return { outcome: "WIN", labelForList: "🏆 WIN (TP1+)", countsTowardTradingClosed: true };
    }
    return { outcome: "LOSS", labelForList: "🛑 LOSS (Direct SL)", countsTowardTradingClosed: true };
  }
  return { outcome: null, labelForList: "", countsTowardTradingClosed: false };
}

export function summarizeOutcomesForDay(events = [], dayKey = "") {
  const dk = String(dayKey || "").trim();
  const stateById = buildPositionStateMapFromEvents(events);
  const outcomeById = {};
  let winCount = 0;
  let directSlCount = 0;
  let expiredCount = 0;
  let tradingClosed = 0;

  for (const state of Object.values(stateById)) {
    if (!state.closedDayUTC || state.closedDayUTC !== dk) continue;
    const derived = deriveOutcomeForState(state);
    outcomeById[state.positionId] = derived;
    if (derived.outcome === "EXPIRED") expiredCount += 1;
    else if (derived.outcome === "WIN") winCount += 1;
    else if (derived.outcome === "LOSS") directSlCount += 1;
    if (derived.countsTowardTradingClosed) tradingClosed += 1;
  }

  return { winCount, directSlCount, expiredCount, tradingClosed, outcomeById, stateById };
}

export function buildStateFromPosition(pos) {
  if (!pos) {
    return {
      symbol: "",
      positionId: "",
      tpLevel: 0,
      hasEntry: false,
      expiredNoEntry: false,
      closedBySL: false,
      closedByOther: false,
      closedDayUTC: ""
    };
  }
  const status = normUpper(pos.status);
  const closed = status === "CLOSED" || String(pos?.status || "").toUpperCase().startsWith("CLOSED") || Number(pos?.closedAt || 0) > 0;
  const expired = status === "EXPIRED";
  const tpLevel = getTpHitMax(pos);
  const sl = Boolean(pos.slHit) || Boolean(pos.slHitAt) || Boolean(pos.slHitAtUtc);
  const closedAt = Number(pos?.closedAt || 0);
  const closedDayUTC = closedAt ? new Date(closedAt).toISOString().slice(0, 10) : "";

  return {
    symbol: pos?.symbol || "",
    positionId: pos?.id || "",
    tpLevel,
    hasEntry: Boolean(pos?.entryHitAt || pos?.filledAt),
    expiredNoEntry: expired,
    closedBySL: closed && sl,
    closedByOther: closed && !sl,
    closedDayUTC
  };
}
