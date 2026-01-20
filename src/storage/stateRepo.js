import path from "node:path";
import { DATA_DIR } from "../config/constants.js";
import { utcDateKey } from "../utils/time.js";
import { readJson, writeJsonAtomic } from "./jsonStore.js";

const FILE = path.join(DATA_DIR, "state.json");

function dayInit() {
  return {
    autoTotal: 0,
    scanTotal: 0,
    tfBreakdown: { "15m": 0, "30m": 0, "1h": 0, "4h": 0 },
    topScore: 0,
    scoreSum: 0,
    scoreCount: 0,
    win: 0,
    lose: 0,
    macro: { BULLISH: 0, BEARISH: 0, NEUTRAL: 0 }
  };
}

export class StateRepo {
  constructor() {
    this.state = {
      daily: {},
      sent: {}, // symbol -> ts
      lastAutoCandle: {}, // tf -> closeTime
      lastRecapSentForDay: "",
      lastRankCache: [] // for /top
    };
    this._queue = Promise.resolve();
  }

  async load() {
    this.state = await readJson(FILE, this.state);
    if (!this.state.daily) this.state.daily = {};
    if (!this.state.sent) this.state.sent = {};
    if (!this.state.lastAutoCandle) this.state.lastAutoCandle = {};
    if (!this.state.lastRankCache) this.state.lastRankCache = [];
  }

  _day(key = utcDateKey()) {
    if (!this.state.daily[key]) this.state.daily[key] = dayInit();
    return this.state.daily[key];
  }

  bumpScan(tf) {
    const day = this._day();
    day.scanTotal += 1;
    if (day.tfBreakdown[tf] !== undefined) day.tfBreakdown[tf] += 1;
  }

  bumpAuto(tf, score, btcState) {
    const day = this._day();
    day.autoTotal += 1;
    if (day.tfBreakdown[tf] !== undefined) day.tfBreakdown[tf] += 1;
    const s = Math.round(Number(score) || 0);
    day.topScore = Math.max(day.topScore, s);
    day.scoreSum += s;
    day.scoreCount += 1;
    if (btcState && day.macro[btcState] !== undefined) day.macro[btcState] += 1;
  }

  bumpOutcome(ts, isWin) {
    const key = utcDateKey(ts);
    const day = this._day(key);
    if (isWin) day.win += 1;
    else day.lose += 1;
  }

  getAutoTotalToday() {
    return this._day().autoTotal;
  }

  canSendSymbol(symbol, cooldownMinutes) {
    const k = String(symbol).toUpperCase();
    const last = Number(this.state.sent[k] || 0);
    if (!last) return true;
    return Date.now() - last >= Number(cooldownMinutes) * 60_000;
  }

  markSent(symbol) {
    const k = String(symbol).toUpperCase();
    this.state.sent[k] = Date.now();
  }

  lastAutoCandle(tf) {
    return Number(this.state.lastAutoCandle[String(tf)] || 0);
  }

  markAutoCandle(tf, closeTime) {
    this.state.lastAutoCandle[String(tf)] = Number(closeTime || 0);
  }

  setRecapSent(dayKey) {
    this.state.lastRecapSentForDay = String(dayKey);
  }

  setRankCache(rows) {
    this.state.lastRankCache = Array.isArray(rows) ? rows : [];
  }

  getRankCache() {
    return this.state.lastRankCache || [];
  }

  async flush() {
    this._queue = this._queue.then(() => writeJsonAtomic(FILE, this.state));
    return this._queue;
  }
}
