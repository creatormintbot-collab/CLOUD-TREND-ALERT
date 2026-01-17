import { ENV } from "../config/env.js";
import { pollAndUpdatePositions } from "../positions/monitor.js";
import { sendToAllowedChats } from "../bot/telegram.js";
import { buildTPCard } from "../bot/ui/tpCard.js";
import { buildSLCard } from "../bot/ui/slCard.js";

function suggestedSL_TP1(pos) {
  // Move SL to BE
  return pos.entryMid;
}

function suggestedSL_TP2(pos) {
  // LONG  → max(entryMid + 0.5*SLdist, EMA mid)
  // SHORT → min(entryMid − 0.5*SLdist, EMA mid)
  const half = 0.5 * (pos.slDist || Math.abs(pos.entryMid - pos.sl));
  const emaMid = Number.isFinite(pos.emaMidAtEntry) ? pos.emaMidAtEntry : pos.entryMid;

  if (pos.direction === "LONG") return Math.max(pos.entryMid + half, emaMid);
  return Math.min(pos.entryMid - half, emaMid);
}

export function createPositionMonitorJob({ positions }) {
  async function tick() {
    await pollAndUpdatePositions({
      positions,
      onTP1: async (pos, price) => {
        const { html } = buildTPCard({
          pos,
          price,
          tpLevel: 1,
          partialPct: ENV.TP1_PARTIAL,
          actionLines: ["Secure partial profit", "Move SL to BE"],
          suggestedSL: suggestedSL_TP1(pos),
        });
        await sendToAllowedChats({ html });
      },
      onTP2: async (pos, price) => {
        const { html } = buildTPCard({
          pos,
          price,
          tpLevel: 2,
          partialPct: ENV.TP2_PARTIAL,
          actionLines: ["Lock more profit", "Trail SL recommended"],
          suggestedSL: suggestedSL_TP2(pos),
        });
        await sendToAllowedChats({ html });
      },
      onTP3: async (pos, price) => {
        const { html } = buildTPCard({
          pos,
          price,
          tpLevel: 3,
          partialPct: ENV.TP3_PARTIAL,
          actionLines: ["Take full profit", "Close position"],
          suggestedSL: null,
        });
        await sendToAllowedChats({ html });
      },
      onSL: async (pos, price) => {
        const { html } = buildSLCard({ pos, price });
        await sendToAllowedChats({ html });
      },
    });
  }

  return { tick };
}
