const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 50 };

function normLevel(x) {
  const s = String(x || "info").toLowerCase();
  return LEVELS[s] ? s : "info";
}

function makeLogger(level) {
  const min = LEVELS[normLevel(level)];

  const write = (lvl, msg, meta) => {
    if (LEVELS[lvl] < min) return;
    const line = {
      ts: new Date().toISOString(),
      level: lvl,
      msg: String(msg ?? ""),
      ...(meta && typeof meta === "object" ? meta : {})
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(line));
  };

  return {
    debug: (msg, meta) => write("debug", msg, meta),
    info: (msg, meta) => write("info", msg, meta),
    warn: (msg, meta) => write("warn", msg, meta),
    error: (msg, meta) => write("error", msg, meta)
  };
}

export const logger = makeLogger(process.env.LOG_LEVEL || "info");
export function createLogger(level) {
  return makeLogger(level);
}
