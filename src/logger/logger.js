const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 50 };

function normLevel(x) {
  const s = String(x || "info").toLowerCase();
  return LEVELS[s] ? s : "info";
}

function formatError(err) {
  if (!err || typeof err !== "object") return { message: String(err ?? "") };
  const out = {
    name: err.name,
    message: err.message,
    stack: err.stack
  };
  if (err.code !== undefined) out.code = err.code;
  if (err.cause !== undefined) {
    out.cause = err.cause === err ? "[Circular]" : safeSerialize(err.cause);
  }
  if (Array.isArray(err.errors)) {
    out.errors = err.errors.map((e) => safeSerialize(e));
  }
  return out;
}

function safeSerialize(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (value instanceof Error) return formatError(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return value.toString("utf8");

  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((v) => safeSerialize(v, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = safeSerialize(v, seen);
    }
    return out;
  }

  return value;
}

function mergeMeta(meta, extra) {
  const base = meta && typeof meta === "object" && !(meta instanceof Error) ? meta : {};
  const out = { ...base };
  if (extra && typeof extra === "object") Object.assign(out, extra);
  return out;
}

function normalizeArgs(msg, meta) {
  let message = msg;
  let metadata = meta;

  if (message && typeof message === "object" && typeof metadata === "string") {
    const tmp = metadata;
    metadata = message;
    message = tmp;
  }

  if (message instanceof Error) {
    metadata = mergeMeta(metadata, { err: message });
    message = message.message || message.name || "error";
  } else if (message && typeof message === "object") {
    metadata = mergeMeta(metadata, message);
    message = "";
  }

  if (metadata instanceof Error) metadata = { err: metadata };

  if (message === null || message === undefined) message = "";
  if (typeof message !== "string") message = String(message);

  return { message, metadata };
}

function makeLogger(level) {
  const min = LEVELS[normLevel(level)];

  const write = (lvl, msg, meta) => {
    if (LEVELS[lvl] < min) return;

    const { message, metadata } = normalizeArgs(msg, meta);
    const line = {
      ts: new Date().toISOString(),
      level: lvl,
      msg: message
    };

    const safeMeta = metadata && typeof metadata === "object" ? safeSerialize(metadata) : null;
    if (safeMeta && typeof safeMeta === "object" && Object.keys(safeMeta).length) {
      Object.assign(line, safeMeta);
    }

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
