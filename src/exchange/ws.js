import WebSocket from "ws";
import { ENV } from "../config/env.js";

export function createKlineWS({ streams, onMessage, onOpen, onClose, onError }) {
  // streams: ["btcusdt@kline_15m", ...]
  const url = new URL(ENV.BINANCE_WS);
  url.searchParams.set("streams", streams.join("/"));

  const ws = new WebSocket(url.toString());

  ws.on("open", () => onOpen?.());
  ws.on("close", (code, reason) => onClose?.(code, reason?.toString?.() || ""));
  ws.on("error", (e) => onError?.(e));
  ws.on("message", (buf) => {
    try {
      const msg = JSON.parse(buf.toString("utf8"));
      onMessage?.(msg);
    } catch {}
  });

  return ws;
}
