import { ENV } from "../config/env.js";

async function httpGet(path, params = {}) {
  const url = new URL(ENV.BINANCE_FAPI + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`REST ${path} failed ${res.status}: ${text}`);
  }
  return res.json();
}

export const binanceRest = {
  async ticker24h() {
    return httpGet("/fapi/v1/ticker/24hr");
  },

  async exchangeInfo() {
    return httpGet("/fapi/v1/exchangeInfo");
  },

  async klines(symbol, interval, limit = 300) {
    return httpGet("/fapi/v1/klines", { symbol, interval, limit });
  },

  async price(symbol) {
    const j = await httpGet("/fapi/v1/ticker/price", { symbol });
    return Number(j.price);
  },
};
