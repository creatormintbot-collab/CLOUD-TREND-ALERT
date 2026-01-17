import WebSocket from "ws";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class BinanceWsGroup {
  constructor({ wsBase, streams, logger, backoffBaseMs, backoffMaxMs, name }) {
    this.wsBase = wsBase;
    this.streams = streams;
    this.log = logger;
    this.backoffBaseMs = backoffBaseMs;
    this.backoffMaxMs = backoffMaxMs;
    this.name = name;

    this.ws = null;
    this.closedByUser = false;
    this.onMessage = null;

    this._attempt = 0;
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
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }
    this.ws = null;
  }

  async _connect() {
    const url = this.url();
    this.log.info({ name: this.name, streams: this.streams.length }, "WS connect");
    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      this._attempt = 0;
      this.log.info({ name: this.name }, "WS open");
    });

    this.ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString("utf8"));
        this.onMessage?.(msg);
      } catch (e) {
        this.log.warn({ name: this.name, err: String(e) }, "WS parse failed");
      }
    });

    this.ws.on("close", async () => {
      this.log.warn({ name: this.name }, "WS closed");
      this.ws = null;
      if (this.closedByUser) return;
      await this._reconnect();
    });

    this.ws.on("error", async (err) => {
      this.log.warn({ name: this.name, err: String(err) }, "WS error");
      // 'close' event will handle reconnect in most cases
    });
  }

  async _reconnect() {
    const backoff = Math.min(
      this.backoffBaseMs * 2 ** this._attempt,
      this.backoffMaxMs
    );
    this._attempt += 1;
    this.log.warn({ name: this.name, backoff }, "WS reconnect backoff");
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
