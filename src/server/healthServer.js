import http from "node:http";

export function startHealthServer({ port, getStatus }) {
  const server = http.createServer((req, res) => {
    if (req.url === "/healthz") {
      const body = JSON.stringify(getStatus?.() || { ok: true });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  server.listen(port);
  return server;
}
