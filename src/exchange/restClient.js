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


function isAbortError(e) {
  const name = e?.name;
  const msg = String(e?.message || e || "");
  return (
    name === "AbortError" ||
    msg.includes("AbortError") ||
    msg.includes("aborted") ||
    msg.includes("The operation was aborted") ||
    msg.includes("This operation was aborted")
  );
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
          throw err;
        }
        return await res.json();
      } catch (e0) {
        const e = isAbortError(e0)
          ? (() => {
              const err = new Error(`REST_TIMEOUT after ${this.timeoutMs}ms`, { cause: e0 });
              err.code = "ETIMEDOUT";
              return err;
            })()
          : e0;

        if (attempt >= this.retryMax) throw e;
        const backoff = this.retryBaseMs * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * 120);
        await sleep(Math.min(3000, backoff + jitter));
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
