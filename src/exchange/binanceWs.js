import WebSocket from "ws";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function withJitter(ms) {
  const jitter = Math.floor(Math.random() * 150);
  return ms + jitter;
}

export class BinanceWsGroup {
  constructor({
    wsBase,
    streams,
    logger,
    backoffBaseMs,
    backoffMaxMs,
    name,
    // Heartbeat (safe defaults)
    pingIntervalMs = 15000,
    pongTimeoutMs = 30000
  }) {
    this.wsBase = wsBase;
    this.streams = streams;
    this.log = logger;
    this.backoffBaseMs = backoffBaseMs;
    this.backoffMaxMs = backoffMaxMs;
    this.name = name;

    this.pingIntervalMs = pingIntervalMs;
    this.pongTimeoutMs = pongTimeoutMs;

    this.ws = null;
    this.closedByUser = false;
    this.onMessage = null;

    this._attempt = 0;
    this._reconnecting = false;

    this._pingTimer = null;
    this._pongTimer = null;
  }

  url() {
    const s = this.streams.join("/");
    return `${this.wsBase}?streams=${s}`;
  }

  setHandler(fn) {
    this.onMessage = fn;
  }

  async start() {
    this.closedByUser = false;
    await this._connect();
  }

  async stop() {
    this.closedByUser = true;
    this._clearHeartbeat();

    if (this.ws) {
      try {
        this.ws.removeAllListeners();
      } catch {}

      try {
        this.ws.close();
      } catch {}

      try {
        // Ensure it closes quickly
        this.ws.terminate();
      } catch {}
    }

    this.ws = null;
  }

  _clearHeartbeat() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
    if (this._pongTimer) {
      clearTimeout(this._pongTimer);
      this._pongTimer = null;
    }
  }

  _armPongTimeout() {
    if (!this.pongTimeoutMs) return;
    if (this._pongTimer) clearTimeout(this._pongTimer);
    this._pongTimer = setTimeout(() => {
      if (this.closedByUser) return;
      this.log?.warn?.({ name: this.name }, "WS heartbeat timeout -> terminate");
      try {
        this.ws?.terminate();
      } catch {}
    }, this.pongTimeoutMs);
  }

  _startHeartbeat() {
    this._clearHeartbeat();
    if (!this.pingIntervalMs) return;

    this._armPongTimeout();

    this._pingTimer = setInterval(() => {
      if (this.closedByUser) return;
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try {
        this.ws.ping();
        this._armPongTimeout();
      } catch (e) {
        this.log?.warn?.({ name: this.name, err: String(e) }, "WS ping failed");
      }
    }, this.pingIntervalMs);
  }

  async _connect() {
    const url = this.url();
    this.log?.info?.({ name: this.name, streams: this.streams.length }, "WS connect");

    // If there is a stale ws object, hard cleanup before creating a new one
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
      } catch {}
      try {
        this.ws.terminate();
      } catch {}
      this.ws = null;
    }

    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      this._attempt = 0;
      this._reconnecting = false;
      this.log?.info?.({ name: this.name }, "WS open");
      this._startHeartbeat();
    });

    this.ws.on("pong", () => {
      // Received pong: refresh timeout
      this._armPongTimeout();
    });

    this.ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString("utf8"));
        this.onMessage?.(msg);
      } catch (e) {
        this.log?.warn?.({ name: this.name, err: String(e) }, "WS parse failed");
      }
    });

    this.ws.on("close", async (code, reason) => {
      this._clearHeartbeat();
      this.log?.warn?.({ name: this.name, code, reason: String(reason || "") }, "WS closed");

      // cleanup listeners to avoid any retention
      try {
        this.ws?.removeAllListeners();
      } catch {}

      this.ws = null;
      if (this.closedByUser) return;
      await this._reconnect();
    });

    this.ws.on("error", async (err) => {
      this.log?.warn?.({ name: this.name, err: String(err) }, "WS error");
      if (this.closedByUser) return;

      const rs = this.ws?.readyState;
      if (rs === WebSocket.CLOSING || rs === WebSocket.CLOSED) return;

      try {
        this.ws?.terminate();
      } catch {}
    });
  }

  async _reconnect() {
    if (this._reconnecting) return;
    this._reconnecting = true;

    const base = this.backoffBaseMs * 2 ** this._attempt;
    const backoff = clamp(withJitter(base), this.backoffBaseMs, this.backoffMaxMs);
    this._attempt += 1;

    this.log?.warn?.({ name: this.name, backoff, attempt: this._attempt }, "WS reconnect backoff");
    await sleep(backoff);

    if (!this.closedByUser) {
      await this._connect();
    }
  }
}

export function chunkStreams(streams, maxPerSocket) {
  const out = [];
  for (let i = 0; i < streams.length; i += maxPerSocket) {
    out.push(streams.slice(i, i + maxPerSocket));
  }
  return out;
}
