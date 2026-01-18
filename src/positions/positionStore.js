import fs from "fs";
import path from "path";

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export class PositionStore {
  constructor({ dataDir, logger, env }) {
    this.log = logger;
    this.env = env;

    this.dataDir = dataDir;
    this.positionsFile = path.join(dataDir, "positions.json");
    this.stateFile = path.join(dataDir, "state.json");
    this.signalsDir = path.join(dataDir, "signals");

    ensureDir(this.dataDir);
    ensureDir(this.signalsDir);

    this.positions = readJsonSafe(this.positionsFile, []);
    this.state = readJsonSafe(this.stateFile, {
      cooldown: {}, // key => lastSignalTs
      dailyCount: {}, // YYYY-MM-DD => count
      recapStamp: null,
      universe: { updatedAt: 0, symbols: [] },

      // On-demand scan rotation (per chat) to avoid repeating the same best symbol.
      onDemandLastByChat: {}
    });

    // Backward-compatible defaults for older state.json
    if (!this.state.cooldown) this.state.cooldown = {};
    if (!this.state.dailyCount) this.state.dailyCount = {};
    if (!this.state.universe) this.state.universe = { updatedAt: 0, symbols: [] };
    if (!this.state.onDemandLastByChat) this.state.onDemandLastByChat = {};

    // ====== SAFETY: prevent unbounded growth in RAM + json files ======
    this.cleanupState();
    this.save();
  }

  save() {
    // Keep data bounded before persisting
    this.cleanupState();
    writeJsonAtomic(this.positionsFile, this.positions);
    writeJsonAtomic(this.stateFile, this.state);
  }

  now() {
    return Date.now();
  }

  dayKeyUTC(ts = Date.now()) {
    const d = new Date(ts);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

  // Convert YYYY-MM-DD (UTC) to ms at 00:00:00Z safely
  _dayKeyToMs(dayKey) {
    // dayKey format: YYYY-MM-DD
    const [y, m, d] = dayKey.split("-").map((x) => Number(x));
    if (!y || !m || !d) return 0;
    return Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  }

  cleanupState() {
    const now = this.now();

    // ---- Positions pruning (CLOSED history can grow forever) ----
    const maxClosed = Number(this.env.MAX_CLOSED_POSITIONS ?? 2000);
    const keepClosedDays = Number(this.env.KEEP_CLOSED_DAYS ?? 30);
    const minClosedTs = now - keepClosedDays * 24 * 60 * 60 * 1000;

    if (Array.isArray(this.positions) && this.positions.length) {
      const running = [];
      const closed = [];

      for (const p of this.positions) {
        if (p && p.status === "RUNNING") running.push(p);
        else closed.push(p);
      }

      // drop very old CLOSED by closedAt/openedAt
      const closedFresh = closed.filter((p) => {
        const ts = (p?.closedAt ?? p?.openedAt ?? 0);
        return ts >= minClosedTs;
      });

      // cap CLOSED count: keep most recent by closedAt/openedAt
      closedFresh.sort((a, b) => {
        const ta = (a?.closedAt ?? a?.openedAt ?? 0);
        const tb = (b?.closedAt ?? b?.openedAt ?? 0);
        return tb - ta;
      });

      const cappedClosed = closedFresh.slice(0, Math.max(0, maxClosed));

      this.positions = [...running, ...cappedClosed];
    }

    // ---- dailyCount pruning (grows forever by day key) ----
    const keepDailyDays = Number(this.env.KEEP_DAILYCOUNT_DAYS ?? 14);
    const minDayMs = now - keepDailyDays * 24 * 60 * 60 * 1000;

    if (this.state.dailyCount && typeof this.state.dailyCount === "object") {
      for (const k of Object.keys(this.state.dailyCount)) {
        const dayMs = this._dayKeyToMs(k);
        if (!dayMs || dayMs < minDayMs) delete this.state.dailyCount[k];
      }
    }

    // ---- cooldown pruning (keys can grow; remove stale entries) ----
    const keepCooldownDays = Number(this.env.KEEP_COOLDOWN_DAYS ?? 7);
    const minCooldownTs = now - keepCooldownDays * 24 * 60 * 60 * 1000;

    if (this.state.cooldown && typeof this.state.cooldown === "object") {
      for (const k of Object.keys(this.state.cooldown)) {
        const ts = Number(this.state.cooldown[k] ?? 0);
        if (!ts || ts < minCooldownTs) delete this.state.cooldown[k];
      }
    }

    // ---- onDemandLastByChat pruning (can grow forever by chatId) ----
    const maxChats = Number(this.env.MAX_ONDEMAND_CHATS ?? 200);
    if (this.state.onDemandLastByChat && typeof this.state.onDemandLastByChat === "object") {
      const entries = Object.entries(this.state.onDemandLastByChat).map(([chatId, v]) => ({
        chatId,
        ts: Number(v?.ts ?? 0),
        symbol: v?.symbol
      }));

      if (entries.length > maxChats) {
        // keep newest
        entries.sort((a, b) => b.ts - a.ts);
        const keep = new Set(entries.slice(0, maxChats).map((x) => x.chatId));

        for (const k of Object.keys(this.state.onDemandLastByChat)) {
          if (!keep.has(k)) delete this.state.onDemandLastByChat[k];
        }
      }
    }
  }

  canSendSignal({ symbol, timeframe, direction }) {
    const key = `${symbol}:${timeframe}:${direction}`;
    const last = this.state.cooldown[key] ?? 0;
    const mins = (this.now() - last) / 60000;
    return mins >= this.env.COOLDOWN_MINUTES;
  }

  markSignalSent({ symbol, timeframe, direction }) {
    const key = `${symbol}:${timeframe}:${direction}`;
    this.state.cooldown[key] = this.now();

    const day = this.dayKeyUTC();
    this.state.dailyCount[day] = (this.state.dailyCount[day] ?? 0) + 1;

    this.save();
  }

  dailyLimitReached() {
    const day = this.dayKeyUTC();
    return (this.state.dailyCount[day] ?? 0) >= this.env.MAX_SIGNALS_PER_DAY;
  }

  appendSignalAudit(signalObj) {
    const day = this.dayKeyUTC();
    const file = path.join(this.signalsDir, `${day}.jsonl`);
    fs.appendFileSync(file, JSON.stringify(signalObj) + "\n", "utf8");
  }

  upsertPosition(pos) {
    const idx = this.positions.findIndex(
      (p) => p.symbol === pos.symbol && p.timeframe === pos.timeframe && p.status === "RUNNING"
    );
    if (idx >= 0) this.positions[idx] = pos;
    else this.positions.push(pos);
    this.save();
  }

  listRunning() {
    return this.positions.filter((p) => p.status === "RUNNING");
  }

  closePosition({ symbol, timeframe, reason, closedAt, win, closeOutcome }) {
    const idx = this.positions.findIndex(
      (p) => p.symbol === symbol && p.timeframe === timeframe && p.status === "RUNNING"
    );
    if (idx < 0) return null;
    const p = this.positions[idx];
    p.status = "CLOSED";
    p.closedAt = closedAt ?? this.now();
    p.closeReason = reason;

    // Prefer explicit closeOutcome if provided (PROFIT_FULL / PROFIT_PARTIAL / LOSS)
    if (closeOutcome) p.closeOutcome = closeOutcome;

    // Legacy boolean: treat PROFIT_* as win, LOSS as loss
    if (p.closeOutcome === "PROFIT_FULL" || p.closeOutcome === "PROFIT_PARTIAL") {
      p.win = true;
    } else if (p.closeOutcome === "LOSS") {
      p.win = false;
    } else {
      p.win = Boolean(win);
    }
    this.positions[idx] = p;
    this.save();
    return p;
  }

  // Store the last on-demand /scan pick per chat, used for rotation.
  setOnDemandLast(chatId, { symbol, ts }) {
    if (!chatId) return;
    this.state.onDemandLastByChat[String(chatId)] = { symbol, ts: ts ?? this.now() };
    this.save();
  }

  getOnDemandLast(chatId) {
    if (!chatId) return null;
    return this.state.onDemandLastByChat?.[String(chatId)] ?? null;
  }

  updatePosition(p) {
    const idx = this.positions.findIndex(
      (x) => x.symbol === p.symbol && x.timeframe === p.timeframe && x.openedAt === p.openedAt
    );
    if (idx >= 0) this.positions[idx] = p;
    this.save();
  }

  setUniverse(symbols) {
    this.state.universe = { updatedAt: this.now(), symbols };
    this.save();
  }

  getUniverse() {
    return this.state.universe?.symbols ?? [];
  }

  setRecapStamp(stamp) {
    this.state.recapStamp = stamp;
    this.save();
  }

  getRecapStamp() {
    return this.state.recapStamp;
  }
}
