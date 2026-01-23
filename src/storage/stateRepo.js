import path from "node:path";
import { DATA_DIR } from "../config/constants.js";
import { utcDateKey } from "../utils/time.js";
import { readJson, writeJsonAtomic } from "./jsonStore.js";

const FILE = path.join(DATA_DIR, "state.json");

function dayInit() {
  return {
    // Activity (UTC day)
    autoTotal: 0,
    scanTotal: 0,           // legacy: scan signals sent (kept for backward-compat)
    scanRequests: 0,        // best-effort: /scan requests received
    scanSignalsSent: 0,     // /scan signals actually sent
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
      sent: {}, // symbol|tf -> ts (legacy keys may exist)
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
    const day = this.state.daily[key];

    // Backward-compat normalization (older day objects may miss newer fields)
    if (day.autoTotal == null) day.autoTotal = 0;
    if (day.scanTotal == null) day.scanTotal = 0;
    if (day.scanRequests == null) day.scanRequests = 0;
    if (day.scanSignalsSent == null) day.scanSignalsSent = 0;

    if (!day.tfBreakdown) day.tfBreakdown = { "15m": 0, "30m": 0, "1h": 0, "4h": 0 };
    if (day.tfBreakdown["15m"] == null) day.tfBreakdown["15m"] = 0;
    if (day.tfBreakdown["30m"] == null) day.tfBreakdown["30m"] = 0;
    if (day.tfBreakdown["1h"] == null) day.tfBreakdown["1h"] = 0;
    if (day.tfBreakdown["4h"] == null) day.tfBreakdown["4h"] = 0;

    if (day.topScore == null) day.topScore = 0;
    if (day.scoreSum == null) day.scoreSum = 0;
    if (day.scoreCount == null) day.scoreCount = 0;
    if (day.win == null) day.win = 0;
    if (day.lose == null) day.lose = 0;

    if (!day.macro) day.macro = { BULLISH: 0, BEARISH: 0, NEUTRAL: 0 };
    if (day.macro.BULLISH == null) day.macro.BULLISH = 0;
    if (day.macro.BEARISH == null) day.macro.BEARISH = 0;
    if (day.macro.NEUTRAL == null) day.macro.NEUTRAL = 0;

    return day;
  }

  // Legacy method: many call sites historically used bumpScan(tf) as "scan signal sent"
  bumpScan(tf) {
    const day = this._day();
    day.scanTotal += 1;
    day.scanSignalsSent += 1;
    if (day.tfBreakdown[tf] !== undefined) day.tfBreakdown[tf] += 1;
  }

  // Preferred explicit method: scan signal actually sent
  bumpScanSignalsSent(tf) {
    const day = this._day();
    day.scanTotal += 1;
    day.scanSignalsSent += 1;
    if (day.tfBreakdown[tf] !== undefined) day.tfBreakdown[tf] += 1;
  }

  // Preferred explicit method: /scan request received (even if no signal)
  bumpScanRequest() {
    const day = this._day();
    day.scanRequests += 1;
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

  _normSentKey(symbolOrKey) {
    const raw = String(symbolOrKey || "").trim();
    if (!raw) return "";
    if (!raw.includes("|")) return raw.toUpperCase();
    const [sym, tf] = raw.split("|");
    return `${String(sym || "").toUpperCase()}|${String(tf || "").toLowerCase()}`;
  }

  canSendPairTf(symbol, tf, cooldownMinutes) {
    return this.canSendSymbol(`${symbol}|${tf}`, cooldownMinutes);
  }

  markSentPairTf(symbol, tf) {
    return this.markSent(`${symbol}|${tf}`);
  }

  canSendSymbol(symbolOrKey, cooldownMinutes) {
    const k = this._normSentKey(symbolOrKey);
    const legacy = String(symbolOrKey || "").toUpperCase();
    const last = Number(this.state.sent[k] || this.state.sent[legacy] || 0);
    if (!last) return true;

    const cd = Number(cooldownMinutes);
    if (!Number.isFinite(cd) || cd <= 0) return true;

    return Date.now() - last >= cd * 60_000;
  }

  markSent(symbolOrKey) {
    const k = this._normSentKey(symbolOrKey);
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
