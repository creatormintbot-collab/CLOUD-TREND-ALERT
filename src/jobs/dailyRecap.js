import fs from "fs";
import path from "path";
import { utcDateKey } from "../config/constants.js";
import { buildDailyRecapCard } from "../bot/ui/recapCard.js";
import { sendToAllowedChats } from "../bot/telegram.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const SIGNAL_DIR = path.join(DATA_DIR, "signals");
const RECAP_STATE_PATH = path.join(DATA_DIR, "recap_state.json");

function ensure() {
  fs.mkdirSync(SIGNAL_DIR, { recursive: true });
  if (!fs.existsSync(RECAP_STATE_PATH)) {
    fs.writeFileSync(RECAP_STATE_PATH, JSON.stringify({ lastSentUTC: null }, null, 2));
  }
}

function loadRecapState() {
  ensure();
  try { return JSON.parse(fs.readFileSync(RECAP_STATE_PATH, "utf8")); } catch { return { lastSentUTC: null }; }
}

function saveRecapState(s) {
  ensure();
  fs.writeFileSync(RECAP_STATE_PATH, JSON.stringify(s, null, 2));
}

function loadSignals(utcDate) {
  const p = path.join(SIGNAL_DIR, `signals-${utcDate}.json`);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return []; }
}

export function createDailyRecapJob() {
  const recapState = loadRecapState();

  function computeStats(signals) {
    const total = signals.length;
    const per = {};
    let sum = 0;
    let filtered4h = 0;
    const macro = { riskOn: 0, riskOff: 0, neutral: 0 };

    for (const s of signals) {
      per[s.timeframe] = (per[s.timeframe] || 0) + 1;
      sum += Number(s.score || 0);
      if (s.timeframe === "4h" && Number(s.score || 0) < 75) filtered4h++;

      const bias = s?.macro?.bias;
      if (bias === "RISK_ON") macro.riskOn++;
      else if (bias === "RISK_OFF") macro.riskOff++;
      else macro.neutral++;
    }

    const perTf = Object.entries(per).map(([k, v]) => `${k}=${v}`).join(" | ") || "-";
    const avgScore = total ? sum / total : 0;

    const top5 = signals
      .slice()
      .sort((a, b) => (b.score - a.score))
      .slice(0, 5);

    return { total, perTf, avgScore, top5, filtered4h, macro };
  }

  async function tick() {
    // send recap when day changes UTC (and not sent yet)
    const utcToday = utcDateKey(new Date());
    const lastSent = recapState.lastSentUTC;

    // if never sent -> send yesterday when first run after UTC midnight is tricky
    // MVP: send recap for previous UTC day once UTC date changes and file exists
    if (!lastSent) {
      recapState.lastSentUTC = utcToday;
      saveRecapState(recapState);
      return;
    }

    if (lastSent === utcToday) return;

    // Day changed UTC => send recap for lastSent day
    const signals = loadSignals(lastSent);
    const stats = computeStats(signals);
    const { html } = buildDailyRecapCard({ utcDate: lastSent, stats });
    await sendToAllowedChats({ html });

    recapState.lastSentUTC = utcToday;
    saveRecapState(recapState);
  }

  return { tick };
}
