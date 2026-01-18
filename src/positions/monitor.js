export function checkLifecycle({ position, markPrice, ema55, env }) {
  // returns { events: [TP1|TP2|TP3|SL], updatedPosition }
  const p = { ...position };
  const dir = p.direction; // LONG/SHORT
  const hit = (level) => {
    if (dir === "LONG") return markPrice >= level;
    return markPrice <= level;
  };
  const hitSL = () => {
    if (dir === "LONG") return markPrice <= p.sl;
    return markPrice >= p.sl;
  };

  const events = [];

  if (p.status !== "RUNNING") return { events, updatedPosition: p };

  if (!p.tp1Hit && hit(p.tp1)) {
    p.tp1Hit = true;
    events.push({
      type: "TP1",
      action: ["Secure partial profit (30%)", "Move SL to BE"],
      suggestedSL: p.entryMid
    });
  }

  if (!p.tp2Hit && hit(p.tp2)) {
    p.tp2Hit = true;
    const sldist = Math.abs(p.entryMid - p.sl);
    const suggested =
      dir === "LONG"
        ? Math.max(p.entryMid + 0.5 * sldist, ema55 ?? p.entryMid)
        : Math.min(p.entryMid - 0.5 * sldist, ema55 ?? p.entryMid);

    events.push({
      type: "TP2",
      action: ["Lock more profit (total 60%)", "Trail SL recommended"],
      suggestedSL: suggested
    });
  }

  if (!p.tp3Hit && hit(p.tp3)) {
    p.tp3Hit = true;
    p.status = "CLOSED";
    // Outcome is full profit if TP3 is hit
    p.closeOutcome = "PROFIT_FULL";
    events.push({ type: "TP3", action: ["Close 100%"], suggestedSL: null, outcome: p.closeOutcome });
  }

  if (p.status === "RUNNING" && hitSL()) {
    p.status = "CLOSED";

    // If TP1/TP2 was already hit, treat as partial profit closure (not a pure loss)
    const outcome = p.tp2Hit || p.tp1Hit ? "PROFIT_PARTIAL" : "LOSS";
    p.closeOutcome = outcome;

    events.push({
      type: "SL",
      action: ["Stop Loss hit"],
      suggestedSL: null,
      outcome
    });
  }

  return { events, updatedPosition: p };
}