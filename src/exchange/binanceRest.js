import axios from "axios";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class BinanceRest {
  constructor({ baseURL, timeoutMs, retryMax, retryBaseMs, logger }) {
    this.client = axios.create({
      baseURL,
      timeout: timeoutMs,
      headers: { "User-Agent": "cloud-trend-alert/1.0" }
    });
    this.retryMax = retryMax;
    this.retryBaseMs = retryBaseMs;
    this.log = logger;
  }

  async request(config) {
    let lastErr;
    for (let attempt = 0; attempt <= this.retryMax; attempt++) {
      try {
        return await this.client.request(config);
      } catch (err) {
        lastErr = err;
        const code = err?.response?.status;
        const retryable =
          !code || code === 429 || code >= 500 || err.code === "ECONNABORTED";

        if (!retryable || attempt === this.retryMax) break;

        const backoff = Math.min(
          this.retryBaseMs * 2 ** attempt,
          5000 + this.retryBaseMs * 2 ** attempt
        );
        this.log.warn(
          { attempt, code, backoff, url: config?.url },
          "REST retry"
        );
        await sleep(backoff);
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
