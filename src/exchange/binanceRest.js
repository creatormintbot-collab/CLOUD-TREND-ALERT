import axios from "axios";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function parseRetryAfterMs(err) {
  const ra = err?.response?.headers?.["retry-after"];
  if (!ra) return 0;
  const seconds = Number(String(ra).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return clamp(Math.floor(seconds * 1000), 0, 60_000);
}

class Semaphore {
  constructor(max) {
    this.max = Math.max(1, Number(max) || 1);
    this.inFlight = 0;
    this.q = [];
  }

  async acquire() {
    if (this.inFlight < this.max) {
      this.inFlight += 1;
      return;
    }
    await new Promise((resolve) => this.q.push(resolve));
    this.inFlight += 1;
  }

  release() {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const next = this.q.shift();
    if (next) next();
  }
}

export class BinanceRest {
  constructor({ baseURL, timeoutMs, retryMax, retryBaseMs, logger, maxConcurrent = 8, minIntervalMs = 0 }) {
    this.client = axios.create({
      baseURL,
      timeout: timeoutMs,
      headers: { "User-Agent": "cloud-trend-alert/1.0" }
    });

    this.retryMax = Number.isFinite(retryMax) ? retryMax : 2;
    this.retryBaseMs = Number.isFinite(retryBaseMs) ? retryBaseMs : 250;
    this.log = logger;

    this._sem = new Semaphore(maxConcurrent);
    this._minIntervalMs = Math.max(0, Number(minIntervalMs) || 0);
    this._lastReqAt = 0;
  }

  async _rateLimitGate(meta) {
    if (!this._minIntervalMs) return;
    const now = Date.now();
    const wait = this._lastReqAt + this._minIntervalMs - now;
    if (wait > 0) {
      this.log?.debug?.({ wait, ...meta }, "REST min-interval gate");
      await sleep(wait);
    }
    this._lastReqAt = Date.now();
  }

  async request(config) {
    let lastErr;

    for (let attempt = 0; attempt <= this.retryMax; attempt++) {
      await this._sem.acquire();
      try {
        await this._rateLimitGate({ url: config?.url, method: config?.method });
        return await this.client.request(config);
      } catch (err) {
        lastErr = err;
        const code = err?.response?.status;

        const isBanned = code === 418; // IP banned (temporary)
        const retryable =
          !code || code === 429 || code >= 500 || err.code === "ECONNABORTED" || isBanned;

        if (!retryable || attempt === this.retryMax) break;

        const retryAfter = parseRetryAfterMs(err);
        const exp = this.retryBaseMs * 2 ** attempt;
        const jitter = Math.floor(Math.random() * 120);

        let backoff;
        if (isBanned) {
          backoff = 60_000;
        } else {
          backoff = clamp(exp + jitter, this.retryBaseMs, 15_000);
          if (retryAfter > 0) backoff = Math.max(backoff, retryAfter);
        }

        this.log?.warn?.(
          { attempt, code, backoff, retryAfter, url: config?.url, method: config?.method },
          "REST retry"
        );

        await sleep(backoff);
      } finally {
        this._sem.release();
      }
    }

    throw lastErr;
  }

  async exchangeInfo() {
    const r = await this.request({ method: "GET", url: "/fapi/v1/exchangeInfo" });
    return r.data;
  }

  async ticker24h() {
    const r = await this.request({ method: "GET", url: "/fapi/v1/ticker/24hr" });
    return r.data;
  }

  async klines({ symbol, interval, limit = 300 }) {
    const r = await this.request({
      method: "GET",
      url: "/fapi/v1/klines",
      params: { symbol, interval, limit }
    });
    return r.data;
  }

  async markPrice(symbol) {
    const r = await this.request({
      method: "GET",
      url: "/fapi/v1/premiumIndex",
      params: symbol ? { symbol } : {}
    });
    return r.data;
  }
}