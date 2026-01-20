function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function toQuery(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export class RestClient {
  constructor({ baseUrl, timeoutMs = 8000, retryMax = 2, retryBaseMs = 250 } = {}) {
    this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
    this.timeoutMs = Number(timeoutMs || 8000);
    this.retryMax = Number(retryMax || 2);
    this.retryBaseMs = Number(retryBaseMs || 250);
  }

  async _request(path, params) {
    const url = `${this.baseUrl}${path}${toQuery(params)}`;

    for (let attempt = 0; attempt <= this.retryMax; attempt++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await fetch(url, { method: "GET", signal: ctrl.signal, headers: { "content-type": "application/json" } });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          const err = new Error(`HTTP ${res.status} ${res.statusText} ${txt}`.slice(0, 300));
          err.status = res.status;
          const ra = res.headers?.get?.("retry-after");
          const raSec = ra != null ? Number(ra) : NaN;
          if (Number.isFinite(raSec) && raSec > 0) err.retryAfterMs = raSec * 1000;
          throw err;
        }
        return await res.json();
      } catch (e) {
        if (attempt >= this.retryMax) throw e;
        const backoff = this.retryBaseMs * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * 120);
        const status = Number(e?.status || 0);
        let waitMs = backoff + jitter;

        // Binance can rate-limit (418/429). Give it extra room to recover.
        if (status === 418 || status === 429 || status === 503) {
          const raMs = Number(e?.retryAfterMs || 0);
          waitMs = Math.max(waitMs, raMs);
          if (status === 418 || status === 429) waitMs = waitMs * 4;
          await sleep(Math.min(15_000, waitMs));
        } else {
          await sleep(Math.min(3000, waitMs));
        }
      } finally {
        clearTimeout(t);
      }
    }
    return null;
  }

  exchangeInfo() { return this._request("/fapi/v1/exchangeInfo"); }
  ticker24h(symbol) { return this._request("/fapi/v1/ticker/24hr", symbol ? { symbol } : undefined); }
  premiumIndex({ symbol } = {}) { return this._request("/fapi/v1/premiumIndex", symbol ? { symbol } : undefined); }
  klines({ symbol, interval, limit, startTime, endTime } = {}) {
    return this._request("/fapi/v1/klines", { symbol, interval, limit, startTime, endTime });
  }
}