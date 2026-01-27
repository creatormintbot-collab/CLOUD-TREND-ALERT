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
    this._sockets = []; // { id, streams, ws, attempt, timer, open, generation, connId }
    this._nextId = 1;

    // telemetry
    this._lastMessageAt = 0;
    this._lastOpenAt = 0;

    this._generation = 0;
    this._setStreamsLock = Promise.resolve();
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

  _readyStateName(state) {
    switch (state) {
      case 0: return "CONNECTING";
      case 1: return "OPEN";
      case 2: return "CLOSING";
      case 3: return "CLOSED";
      default: return String(state);
    }
  }

  _socketMeta(sock, reason, wsOverride) {
    const ws = wsOverride || sock?.ws;
    const rs = ws?.readyState;
    return {
      wsId: sock?.id,
      readyState: this._readyStateName(rs),
      readyStateCode: Number.isFinite(rs) ? rs : undefined,
      reason,
      generation: sock?.generation,
      connId: sock?.connId
    };
  }

  _isStale(sock) {
    return !sock || sock.generation !== this._generation;
  }

  _isRecoverableWsError(err, sock, ws) {
    const msg = String(err?.message || err || "");
    if (!msg) return false;
    const lowered = msg.toLowerCase();
    if (!lowered.includes("closed before the connection was established")) return false;

    const rs = ws?.readyState;
    const connecting = rs === 0;
    const reason = sock?.closeReason || sock?._closing;

    if (connecting) return true;
    if (reason && String(reason).startsWith("reconcile")) return true;
    return false;
  }

  _safeClose(ws, sock, reason) {
    if (!ws) return;

    const rs = ws.readyState;
    try {
      if (rs === 0) {
        if (typeof ws.terminate === "function") ws.terminate();
        return;
      }
      if (typeof ws.close === "function" && rs !== 3) ws.close();
    } catch (err) {
      const meta = this._socketMeta(sock, reason, ws);
      meta.errorMessage = String(err?.message || err || "");
      this.logger?.debug?.(`[ws:${sock?.id}] safeClose error`, meta);
    }
  }

  async setStreams(streams) {
    const desired = Array.from(new Set((streams || []).filter(Boolean)));

    const run = async () => {
      const ok = await this._ensureWsLoaded();
      this._streams = desired;
      const generation = ++this._generation;

      if (!ok) return;

      const chunks = chunkArray(this._streams, this.maxStreamsPerSocket);
      await this._reconcileSockets(chunks, generation);
    };

    this._setStreamsLock = (this._setStreamsLock || Promise.resolve()).then(run, run);
    return this._setStreamsLock;
  }

  async _reconcileSockets(chunks, generation) {
    while (this._sockets.length > chunks.length) {
      const s = this._sockets.pop();
      this._closeSocket(s, "reconcile_extra");
    }

    for (let i = 0; i < chunks.length; i++) {
      const desired = chunks[i];
      const existing = this._sockets[i];

      if (existing && this._sameStreams(existing.streams, desired)) {
        existing.streams = desired;
        existing.generation = generation;
        existing._closing = null;
        existing.closeReason = null;
        continue;
      }

      if (existing) this._closeSocket(existing, "reconcile_update");

      const sock = {
        id: this._nextId++,
        streams: desired,
        ws: null,
        attempt: 0,
        timer: null,
        open: false,
        generation,
        connId: 0,
        closeReason: null,
        _closing: null
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
    if (this._isStale(sock)) return;
    if (sock._closing && sock._closing !== "reconnect") return;

    const url = this._buildUrl(sock.streams);
    const ws = new this._WS(url, { handshakeTimeout: 10_000 });
    const connId = (sock.connId || 0) + 1;

    sock.ws = ws;
    sock.connId = connId;
    sock.open = false;
    sock._closing = null;
    sock.closeReason = null;

    const isCurrent = () => sock.ws === ws && sock.connId === connId && !this._isStale(sock);

    ws.on("open", () => {
      if (!isCurrent()) return;
      sock.attempt = 0;
      sock.open = true;
      this._lastOpenAt = Date.now();
      this.logger?.info?.(
        `[ws:${sock.id}] connected streams=${sock.streams.length}`,
        this._socketMeta(sock, "open", ws)
      );
    });

    ws.on("message", (buf) => {
      if (!isCurrent()) return;
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
      if (!isCurrent()) return;
      const msg = String(err?.message || err || "");
      const meta = this._socketMeta(sock, sock.closeReason || "error", ws);
      meta.errorMessage = msg;

      if (this._isRecoverableWsError(err, sock, ws)) {
        this.logger?.warn?.(`[ws:${sock.id}] error (recoverable)`, meta);
        return;
      }

      this.logger?.warn?.(`[ws:${sock.id}] error`, meta);
    });

    ws.on("close", (code, reason) => {
      if (!isCurrent()) return;
      sock.open = false;

      if (sock._closing) return;

      const meta = this._socketMeta(sock, sock.closeReason || "close", ws);
      if (code !== undefined) meta.closeCode = code;
      const reasonStr = typeof reason?.toString === "function" ? reason.toString() : reason;
      if (reasonStr) meta.closeReason = reasonStr;

      this.logger?.warn?.(`[ws:${sock.id}] closed`, meta);
      this._scheduleReconnect(sock);
    });
  }

  _scheduleReconnect(sock) {
    if (this._disabled) return;
    if (this._isStale(sock)) return;
    if (sock._closing) return;

    if (sock.timer) clearTimeout(sock.timer);
    sock.attempt = (sock.attempt || 0) + 1;

    const base = this.backoffBaseMs * Math.pow(2, Math.min(sock.attempt, 8));
    const jitter = Math.floor(Math.random() * 250);
    const delay = Math.min(this.backoffMaxMs, base + jitter);

    sock.timer = setTimeout(() => {
      sock.timer = null;
      if (this._disabled || this._isStale(sock) || sock._closing) return;
      this._closeSocket(sock, "reconnect");
      this._connect(sock);
    }, delay);
  }

  _closeSocket(sock, reason) {
    if (!sock) return;

    try {
      if (sock.timer) clearTimeout(sock.timer);
      sock.timer = null;
    } catch {}

    sock.open = false;
    sock.closeReason = reason;
    sock._closing = reason;

    const ws = sock.ws;
    const meta = this._socketMeta(sock, reason, ws);

    try {
      if (ws) this._safeClose(ws, sock, reason);
    } catch {}

    sock.ws = null;

    this.logger?.info?.(`[ws:${sock.id}] closed (${reason})`, meta);
  }

  async stop() {
    this._disabled = true;
    for (const s of this._sockets) this._closeSocket(s, "stop");
    this._sockets = [];
  }
}
