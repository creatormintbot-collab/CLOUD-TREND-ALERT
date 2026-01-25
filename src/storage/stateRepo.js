import path from "node:path";
import { DATA_DIR } from "../config/constants.js";
import { utcDateKey } from "../utils/time.js";
import { readJson, writeJsonAtomic } from "./jsonStore.js";

const FILE = path.join(DATA_DIR, "state.json");

function dayInit() {
  return {
    // Activity (UTC day)
    autoTotal: 0,

    // /scan metrics
    scanTotal: 0,           // legacy: scan signals sent (kept for backward-compat)
    scanRequests: 0,        // best-effort: /scan requests received
    scanRequestsSuccess: 0, // best-effort: /scan requests completed (non-fatal). See normalization below.
    scanSignalsSent: 0,     // /scan signals actually sent

    // Quality breakdown (signals created)
    tfBreakdown: { "15m": 0, "30m": 0, "1h": 0, "4h": 0 },
    topScore: 0,
    scoreSum: 0,
    scoreCount: 0,

    // Legacy outcomes (kept; detailed TP/SL stats live in positionsRepo)
    win: 0,
    lose: 0,

    // Macro summary (AUTO only)
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
      lastRankCache: [] // legacy cache (ranking) still used by pipeline
    };
    this._queue = Promise.resolve();
  }

  async load() {
    this.state = await readJson(FILE, this.state);
    if (!this.state.daily) this.state.daily = {};
    if (!this.state.sent) this.state.sent = {};
    if (!this.state.lastAutoCandle) this.state.lastAutoCandle = {};
    if (!this.state.lastRankCache) this.state.lastRankCache = [];
    return this.state;
  }

  // Prefer a cheap in-memory snapshot for command handlers.
  getSnapshot() {
    return this.state;
  }

  // Backward compatible alias.
  getState() {
    return this.state;
  }

  _day(key = utcDateKey()) {
    if (!this.state.daily[key]) this.state.daily[key] = dayInit();
    const day = this.state.daily[key];

    // Backward-compat normalization (older day objects may miss newer fields)
    if (day.autoTotal == null) day.autoTotal = 0;
    if (day.scanTotal == null) day.scanTotal = 0;
    if (day.scanRequests == null) day.scanRequests = 0;
    if (day.scanSignalsSent == null) day.scanSignalsSent = 0;

    // Success counter: if missing, best-effort align with scanRequests (older versions)
    // Note: once call sites start incrementing scanRequestsSuccess explicitly,
    // this field will remain independent.
    if (day.scanRequestsSuccess == null) day.scanRequestsSuccess = day.scanRequests || 0;

    if (!day.tfBreakdown) day.tfBreakdown = { "15m": 0, "30m": 0, "1h": 0, "4h": 0 };
    if (day.tfBreakdown["15m"] == null) day.tfBreakdown["15m"] = 0;
    if (day.tfBreakdown["30m"] == null) day.tfBreakdown["30m"] = 0;
    if (day.tfBreakdown["1h"] == null) day.tfBreakdown["1h"] = 0;
    if (day.tfBreakdown["4h"] == null) day.tfBreakdown["4h"] = 0;

    if (day.topScore == null) day.topScore = 0;
    if (day.scoreSum == null) day.scoreSum = 0;
    if (day.scoreCount == null) day.scoreCount = 0;

    // Provide derived field for UI consumers (do not persist as source of truth).
    day.avgScore = day.scoreCount > 0 ? Math.round(day.scoreSum / day.scoreCount) : 0;

    if (day.win == null) day.win = 0;
    if (day.lose == null) day.lose = 0;

    if (!day.macro) day.macro = { BULLISH: 0, BEARISH: 0, NEUTRAL: 0 };
    if (day.macro.BULLISH == null) day.macro.BULLISH = 0;
    if (day.macro.BEARISH == null) day.macro.BEARISH = 0;
    if (day.macro.NEUTRAL == null) day.macro.NEUTRAL = 0;

    // Alias to match newer UI cards (English).
    day.macroCounts = day.macro;

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

    // Backward compat: keep success aligned in older flows where we cannot distinguish.
    // Newer call sites may increment scanRequestsSuccess explicitly.
    if (day.scanRequestsSuccess < day.scanRequests) day.scanRequestsSuccess = day.scanRequests;
  }

  // Preferred explicit method: /scan completed successfully (non-fatal) regardless of signal.
  bumpScanRequestSuccess() {
    const day = this._day();
    day.scanRequestsSuccess += 1;
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

    const parts = raw.split("|").map((p) => String(p || "").trim()).filter(Boolean);
    if (parts.length === 0) return "";

    const sym = parts[0].toUpperCase();
    const rest = parts.slice(1).map((p) => {
      const s = String(p || "").trim();
      // normalize timeframe tokens to lowercase; keep other tokens uppercase
      const isTf = /^[0-9]+[mhdw]$/i.test(s) || s.toLowerCase() === "1h" || s.toLowerCase() === "4h";
      return isTf ? s.toLowerCase() : s.toUpperCase();
    });

    return [sym, ...rest].join("|");
  }


  canSendPairTf(symbol, tf, cooldownMinutes) {
    return this.canSendSymbol(`${symbol}|${tf}`, cooldownMinutes);
  }

  markSentPairTf(symbol, tf) {
    return this.markSent(`${symbol}|${tf}`);
  }

  // New (LOCK): cooldown keys scoped by pair+side (+ optional playbook).
  canSendPairSide(symbol, direction, cooldownMinutes) {
    return this.canSendSymbol(`${symbol}|${direction}`, cooldownMinutes);
  }

  markSentPairSide(symbol, direction) {
    return this.markSent(`${symbol}|${direction}`);
  }

  canSendPairSidePlaybook(symbol, direction, playbook, cooldownMinutes) {
    return this.canSendSymbol(`${symbol}|${direction}|${playbook}`, cooldownMinutes);
  }

  markSentPairSidePlaybook(symbol, direction, playbook) {
    return this.markSent(`${symbol}|${direction}|${playbook}`);
  }

  canSendSignal(signal, cooldownMinutes) {
    const sym = String(signal?.symbol || '').toUpperCase();
    const dir = String(signal?.direction || '').toUpperCase();
    const pb = String(signal?.playbook || '').toUpperCase();
    if (!sym || !dir) return this.canSendSymbol(sym, cooldownMinutes);
    // Ideal: per pair-per-side-per-playbook when playbook is known.
    if (pb) return this.canSendPairSidePlaybook(sym, dir, pb, cooldownMinutes);
    return this.canSendPairSide(sym, dir, cooldownMinutes);
  }

  markSentSignal(signal) {
    const sym = String(signal?.symbol || '').toUpperCase();
    const dir = String(signal?.direction || '').toUpperCase();
    const pb = String(signal?.playbook || '').toUpperCase();
    if (!sym || !dir) return this.markSent(sym);
    if (pb) return this.markSentPairSidePlaybook(sym, dir, pb);
    return this.markSentPairSide(sym, dir);

  }


  canSendSymbol(symbolOrKey, cooldownMinutes) {
    const k = this._normSentKey(symbolOrKey);
    const legacy = String(symbolOrKey || "").toUpperCase();

    // Backward-compat: older state may have per-symbol keys (without |tf).
    // If call sites mix "SYMBOL" and "SYMBOL|tf", use a safe fallback to prevent duplicates.
    const baseK = k.includes("|") ? k.split("|")[0] : "";
    const baseLegacy = legacy.includes("|") ? legacy.split("|")[0] : "";

    const last = Number(
      this.state.sent[k] ||
      this.state.sent[legacy] ||
      (baseK ? this.state.sent[baseK] : 0) ||
      (baseLegacy ? this.state.sent[baseLegacy] : 0) ||
      0
    );
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