import fs from "fs";
import path from "path";
import { ENV } from "../config/env.js";
import { utcDateKey, clamp } from "../config/constants.js";
import { computeCoreIndicators, entryRule } from "../strategy/intradayPro.js";
import { advancedScores, baseScore, finalScore } from "../strategy/scoring.js";
import { buildEntryCard } from "../bot/ui/entryCard.js";
import { sendToAllowedChats } from "../bot/telegram.js";
import { rankCandidates, pickTopToSend } from "../selection/selector.js";
import { macroAdj, macroAltStrength, macroBTCTrend, macroBias } from "../strategy/macro.js";
import { findRunningPosition, savePositions } from "../positions/store.js";

const DATA_DIR = path.resolve(process.cwd(), "data");
const STATE_PATH = path.join(DATA_DIR, "state.json");
const SIGNAL_DIR = path.join(DATA_DIR, "signals");

function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(SIGNAL_DIR, { recursive: true });
  if (!fs.existsSync(STATE_PATH)) fs.writeFileSync(STATE_PATH, JSON.stringify({ cooldown: {}, lastDir: {}, lastCandle: {} }, null, 2));
}

function loadState() {
  ensureData();
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { return { cooldown: {}, lastDir: {}, lastCandle: {} }; }
}

function saveState(s) {
  ensureData();
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

function signalsPathUTC(dateKey) {
  return path.join(SIGNAL_DIR, `signals-${dateKey}.json`);
}

function appendDailySignalUTC(signal) {
  ensureData();
  const dk = utcDateKey(new Date());
  const p = signalsPathUTC(dk);
  const arr = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
  arr.push(signal);
  fs.writeFileSync(p, JSON.stringify(arr, null, 2));
}

function computeLevels({ direction, entryMid, atr }) {
  const zoneSize = atr * ENV.ZONE_ATR_MULT;
  const entryZoneLow = entryMid - zoneSize;
  const entryZoneHigh = entryMid + zoneSize;

  const slDist = atr * ENV.SL_ATR_MULT;

  const sl = direction === "LONG" ? entryMid - slDist : entryMid + slDist;
  const tp1 = direction === "LONG" ? entryMid + slDist * 1.0 : entryMid - slDist * 1.0;
  const tp2 = direction === "LONG" ? entryMid + slDist * 1.5 : entryMid - slDist * 1.5;
  const tp3 = direction === "LONG" ? entryMid + slDist * 2.0 : entryMid - slDist * 2.0;

  return { entryZoneLow, entryZoneHigh, entryMid, sl, tp1, tp2, tp3, slDist };
}

export function createScannerJob({ candleStore, universeManager, positions, macroFeed }) {
  const state = loadState();

  function cooldownKey(symbol, tf) { return `${symbol}__${tf}`; }
  function dirKey(symbol, tf) { return `${symbol}__${tf}`; }
  function candleKey(symbol, tf) { return `${symbol}__${tf}`; }

  function inCooldown(symbol, tf, closedOpenTime) {
    const key = cooldownKey(symbol, tf);
    const cd = state.cooldown[key];
    if (!cd) return false;
    return closedOpenTime <= cd.untilOpenTime;
  }

  function setCooldown(symbol, tf, closedOpenTime) {
    // cooldown 12 candles => until openTime of (current + 12*tf)
    const key = cooldownKey(symbol, tf);
    const minutes = candleStore.expectedCandleMs(tf);
    const until = closedOpenTime + minutes * ENV.COOLDOWN_CANDLES;
    state.cooldown[key] = { untilOpenTime: until };
  }

  function lastDirection(symbol, tf) {
    return state.lastDir[dirKey(symbol, tf)] || null;
  }

  function setLastDirection(symbol, tf, dir) {
    state.lastDir[dirKey(symbol, tf)] = dir;
  }

  function seenThisCandle(symbol, tf, openTime) {
    return state.lastCandle[candleKey(symbol, tf)] === openTime;
  }

  function markCandle(symbol, tf, openTime) {
    state.lastCandle[candleKey(symbol, tf)] = openTime;
  }

  async function evaluateSymbolTF(symbol, tf) {
    const candles = candleStore.get(symbol, tf);
    if (!candles || candles.length < ENV.BACKFILL_CANDLES - 5) return null;

    const last = candles[candles.length - 1];
    const ind = computeCoreIndicators(candles);
    const rule = entryRule({ candles, ind });
    if (!rule.ok) return null;

    if (inCooldown(symbol, tf, last.openTime)) return null;

    // State-change only: entry hanya saat arah berubah
    const prevDir = lastDirection(symbol, tf);
    if (prevDir && prevDir === rule.direction) return null;

    // Jangan kirim entry jika sudah ada posisi RUNNING symbol+tf
    if (findRunningPosition(positions, symbol, tf)) return null;

    const entryMid = last.close; // candle just closed
    const lv = computeLevels({ direction: rule.direction, entryMid, atr: ind.atr });
    const base = baseScore({ ind, candles });
    const adv = advancedScores({ candles, entryMid, atr: ind.atr, direction: rule.direction });

    // macro context from macroFeed snapshot (stable TF = ENV.MACRO_TF)
    const macro = macroFeed?.snapshot || { tf: ENV.MACRO_TF, btcTrend: "FLAT", altStrength: "FLAT", bias: "NEUTRAL", adj: 0 };
    const adj = macroAdj({ bias: macro.bias, direction: rule.direction });

    const score = finalScore({ base, adv, macroAdj: adj });

    const analysisLines = [];
    analysisLines.push(`EMA mid vs slow: ${ind.emaMid > ind.emaSlow ? "Bullish" : "Bearish"}`);
    analysisLines.push(`Pullback touch EMA${ENV.EMA_FAST}: YES`);
    if (adv.fvg?.fvg) {
      analysisLines.push(`FVG ${adv.fvg.fvg.type}: ${adv.fvg.fvg.low} – ${adv.fvg.fvg.high} (${adv.fvg.proximity.label})`);
    } else {
      analysisLines.push(`FVG: none`);
    }
    if (adv.macd) {
      analysisLines.push(`MACD: hist ${adv.macd.aligned ? "aligned" : "not aligned"} (${adv.macd.strengthening ? "strengthening" : "flat"})`);
    } else {
      analysisLines.push(`MACD: n/a`);
    }
    if (adv.volRatio != null) analysisLines.push(`Volume Ratio: ${adv.volRatio.toFixed(2)}x`);
    analysisLines.push(`ATR%: ${ind.atrPct.toFixed(2)} | ADX: ${ind.adx.toFixed(1)} | RSI: ${ind.rsi.toFixed(1)}`);

    return {
      symbol,
      timeframe: tf,
      direction: rule.direction,
      entryMid,
      levels: lv,
      ind,
      base,
      adv,
      macro: { ...macro, adj },
      score,
      analysisLines,
      candleOpenTime: last.openTime,
    };
  }

  async function onCandleClosed({ symbol, tf, candle }) {
    // gate: ensure we only run once per closed candle (avoid duplicate close events)
    if (seenThisCandle(symbol, tf, candle.openTime)) return;
    markCandle(symbol, tf, candle.openTime);

    const universe = await universeManager.refreshIfNeeded(false);
    if (!universe.includes(symbol)) return;

    // On each close event, we can scan universe for this TF (pro-style)
    const tfToScan = tf;

    const candidates = [];
    for (const sym of universe) {
      const c = await evaluateSymbolTF(sym, tfToScan);
      if (c) candidates.push(c);
    }

    if (!candidates.length) {
      saveState(state);
      return;
    }

    const shortlist = rankCandidates(candidates, 10);
    let toSend = pickTopToSend(shortlist, ENV.MAX_SIGNALS_PER_TF_PER_CANDLE);

    // TF 4h: only send if score >= threshold
    if (tfToScan === ENV.SECONDARY_TIMEFRAME) {
      toSend = toSend.filter((x) => x.score >= ENV.SECONDARY_MIN_SCORE);
    }

    for (const sig of toSend) {
      const { html, buttons } = buildEntryCard(sig);

      await sendToAllowedChats({ html, buttons });

      // persist signal
      appendDailySignalUTC({
        ts: Date.now(),
        symbol: sig.symbol,
        timeframe: sig.timeframe,
        direction: sig.direction,
        score: sig.score,
        entryMid: sig.entryMid,
        entryZoneLow: sig.levels.entryZoneLow,
        entryZoneHigh: sig.levels.entryZoneHigh,
        macro: sig.macro,
      });

      // create & persist position object (RUNNING)
      const pos = {
        symbol: sig.symbol,
        timeframe: sig.timeframe,
        direction: sig.direction,
        entryZoneLow: sig.levels.entryZoneLow,
        entryZoneHigh: sig.levels.entryZoneHigh,
        entryMid: sig.levels.entryMid,
        sl: sig.levels.sl,
        tp1: sig.levels.tp1,
        tp2: sig.levels.tp2,
        tp3: sig.levels.tp3,
        tp1Hit: false,
        tp2Hit: false,
        tp3Hit: false,
        status: "RUNNING",
        openedAt: Date.now(),
        slDist: sig.levels.slDist,
        emaMidAtEntry: sig.ind.emaMid,
      };
      positions.push(pos);
      savePositions(positions);

      // set anti-spam state
      setLastDirection(sig.symbol, sig.timeframe, sig.direction);
      setCooldown(sig.symbol, sig.timeframe, sig.candleOpenTime);
    }

    saveState(state);
  }

  return { onCandleClosed };
}
