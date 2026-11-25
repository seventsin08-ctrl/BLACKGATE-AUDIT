// Local development/test harness: static files + the real API handler on a throwaway local Postgres.
// Never used in production. Usage: node scripts/dev-server.mjs [port]
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { startEnv } from "../tests/helpers.mjs";
import { handle } from "../server/app.mjs";

const port = Number(process.argv[2] || 8888);
const root = join(process.cwd(), "public");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const env = await startEnv();
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname.startsWith("/api/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks);
    const r = await handle(new Request(url, { method: req.method, headers: { ...req.headers, "x-forwarded-for": req.socket.remoteAddress }, body, duplex: "half" }));
    const headers = {}; r.headers.forEach((v, k) => (headers[k] = v));
    const sc = r.headers.getSetCookie?.() || []; if (sc.length) headers["set-cookie"] = sc;
    res.writeHead(r.status, headers); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let p = normalize(url.pathname).replace(/^(\.\.[/\\])+/, ""); if (p.endsWith("/")) p += "index.html";
  try { const data = await readFile(join(root, p)); res.writeHead(200, { "content-type": mime[extname(p)] || "application/octet-stream" }); res.end(data); }
  catch { res.writeHead(404); res.end("Not found"); }
}).listen(port, () => console.log(`dev server http://localhost:${port}  (admin / ${process.env.ADMIN_INITIAL_PASSWORD})`));
process.on("SIGTERM", async () => { await env.stop(); process.exit(0); });
