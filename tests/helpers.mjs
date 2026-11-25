import { NetlifyDB } from "@netlify/database-dev";
import pg from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { setPool } from "../server/db.mjs";
import { setBlobStore } from "../server/files.mjs";
import { handle } from "../server/app.mjs";

export async function startEnv() {
  process.env.APP_SECRET = "test-secret-test-secret-test-secret-123";
  process.env.ADMIN_INITIAL_PASSWORD = "Temp-Pass-1";
  const db = new NetlifyDB();
  const url = await db.start();
  const pool = new pg.Pool({ connectionString: url });
  const dir = "netlify/database/migrations";
  for (const f of readdirSync(dir).sort()) await pool.query(readFileSync(`${dir}/${f}`, "utf8"));
  setPool(pool);
  const maps = new Map();
  setBlobStore({
    async set(k, v, o) { maps.set(k, { v: Buffer.from(v), meta: o?.metadata }); },
    async get(k, o) { const e = maps.get(k); if (!e) return null; return o?.type === "text" ? e.v.toString() : e.v.buffer.slice(e.v.byteOffset, e.v.byteOffset + e.v.length); },
    async getMetadata(k) { const e = maps.get(k); return e ? { metadata: e.meta } : null; },
    async list() { return { blobs: [...maps.keys()].map((key) => ({ key })) }; },
    async delete(k) { maps.delete(k); },
  });
  return { pool, stop: async () => { await pool.end(); await db.stop(); } };
}

export function client(ip = "10.0.0.1") {
  let cookie = "";
  const api = async (method, path, body, opts = {}) => {
    const headers = { "x-requested-with": "bg", "x-forwarded-for": opts.ip || ip, "user-agent": "test" };
    if (cookie) headers.cookie = cookie;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await handle(new Request("https://bg.test" + path, { method, headers, body: payload }));
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.startsWith("bg_session=;") ? "" : sc.split(";")[0];
    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("json") ? await res.json() : await res.text();
    return { status: res.status, data, res };
  };
  return { get: (p, o) => api("GET", p, undefined, o), post: (p, b = {}, o) => api("POST", p, b, o), put: (p, b, o) => api("PUT", p, b, o), patch: (p, b, o) => api("PATCH", p, b, o), delete: (p, o) => api("DELETE", p, undefined, o), clear: () => { cookie = ""; } };
}
// 1x1 png
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
