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
      universe: { updatedAt: 0, symbols: [] }
    });
  }

  save() {
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

  closePosition({ symbol, timeframe, reason, closedAt, win }) {
    const idx = this.positions.findIndex(
      (p) => p.symbol === symbol && p.timeframe === timeframe && p.status === "RUNNING"
    );
    if (idx < 0) return null;
    const p = this.positions[idx];
    p.status = "CLOSED";
    p.closedAt = closedAt ?? this.now();
    p.closeReason = reason;
    p.win = Boolean(win);
    this.positions[idx] = p;
    this.save();
    return p;
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
