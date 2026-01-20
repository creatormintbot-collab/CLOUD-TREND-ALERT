import { chunkArray } from "./intervals.js";

export class WsManager {
  constructor({ wsBase, maxStreamsPerSocket, backoffBaseMs, backoffMaxMs, logger } = {}) {
    this.wsBase = wsBase;
    this.maxStreamsPerSocket = Number(maxStreamsPerSocket || 200);
    this.backoffBaseMs = Number(backoffBaseMs || 500);
    this.backoffMaxMs = Number(backoffMaxMs || 30_000);

    this.logger = logger || console;

    this._handler = null;

    this._WS = null;
    this._disabled = false;

    this._streams = [];
    this._sockets = []; // { id, streams, ws, attempt, timer, open }
    this._nextId = 1;

    // telemetry
    this._lastMessageAt = 0;
    this._lastOpenAt = 0;
  }

  setHandler(fn) {
    this._handler = typeof fn === "function" ? fn : null;
  }

  status() {
    const openSockets = this._sockets.filter((s) => s.open).length;
    return {
      disabled: !!this._disabled,
      sockets: this._sockets.length,
      openSockets,
      lastOpenAt: this._lastOpenAt,
      lastMessageAt: this._lastMessageAt
    };
  }

  async _ensureWsLoaded() {
    if (this._disabled) return false;
    if (this._WS) return true;

    try {
      const mod = await import("ws");
      this._WS = mod.default || mod.WebSocket || mod;
      return true;
    } catch {
      this._disabled = true;
      this.logger?.warn?.("[ws] module not found. WS disabled, REST-only mode.");
      return false;
    }
  }

  _buildUrl(streams) {
    const base = String(this.wsBase || "").trim();
    const prefix = base.includes("streams=") ? base : `${base}${base.includes("?") ? "&" : "?"}streams=`;
    return `${prefix}${streams.join("/")}`;
  }

  async setStreams(streams) {
    const ok = await this._ensureWsLoaded();
    this._streams = Array.from(new Set((streams || []).filter(Boolean)));

    if (!ok) return;

    const chunks = chunkArray(this._streams, this.maxStreamsPerSocket);
    await this._reconcileSockets(chunks);
  }

  async _reconcileSockets(chunks) {
    while (this._sockets.length > chunks.length) {
      const s = this._sockets.pop();
      this._closeSocket(s, "reconcile_extra");
    }

    for (let i = 0; i < chunks.length; i++) {
      const desired = chunks[i];
      const existing = this._sockets[i];

      if (existing && this._sameStreams(existing.streams, desired)) continue;

      if (existing) this._closeSocket(existing, "reconcile_update");

      const sock = {
        id: this._nextId++,
        streams: desired,
        ws: null,
        attempt: 0,
        timer: null,
        open: false
      };

      this._sockets[i] = sock;
      this._connect(sock);
    }
  }

  _sameStreams(a, b) {
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  _connect(sock) {
    if (this._disabled || !this._WS) return;

    const url = this._buildUrl(sock.streams);
    const ws = new this._WS(url, { handshakeTimeout: 10_000 });
    sock.ws = ws;
    sock.open = false;

    ws.on("open", () => {
      sock.attempt = 0;
      sock.open = true;
      this._lastOpenAt = Date.now();
      this.logger?.info?.(`[ws:${sock.id}] connected streams=${sock.streams.length}`);
    });

    ws.on("message", (buf) => {
      this._lastMessageAt = Date.now();
      if (!this._handler) return;

      try {
        const txt = buf?.toString?.("utf8") ?? String(buf);
        const msg = JSON.parse(txt);
        this._handler(msg);
      } catch {
        // ignore parse errors
      }
    });

    ws.on("error", (err) => {
      this.logger?.warn?.(`[ws:${sock.id}] error: ${err?.message || err}`);
    });

    ws.on("close", () => {
      sock.open = false;
      this.logger?.warn?.(`[ws:${sock.id}] closed`);
      this._scheduleReconnect(sock);
    });
  }

  _scheduleReconnect(sock) {
    if (this._disabled) return;

    if (sock.timer) clearTimeout(sock.timer);
    sock.attempt = (sock.attempt || 0) + 1;

    const base = this.backoffBaseMs * Math.pow(2, Math.min(sock.attempt, 8));
    const jitter = Math.floor(Math.random() * 250);
    const delay = Math.min(this.backoffMaxMs, base + jitter);

    sock.timer = setTimeout(() => {
      sock.timer = null;
      this._closeSocket(sock, "reconnect");
      this._connect(sock);
    }, delay);
  }

  _closeSocket(sock, reason) {
    try {
      if (sock?.timer) clearTimeout(sock.timer);
      sock.timer = null;
    } catch {}

    try {
      if (sock?.ws) {
        sock.ws.removeAllListeners?.();
        sock.ws.close?.();
      }
    } catch {}

    sock.ws = null;
    sock.open = false;

    this.logger?.info?.(`[ws:${sock?.id}] closed (${reason})`);
  }

  async stop() {
    this._disabled = true;
    for (const s of this._sockets) this._closeSocket(s, "stop");
    this._sockets = [];
  }
}
