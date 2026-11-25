import { HttpError, json, SEC_HEADERS } from "./util.mjs";
import { authenticate, bootstrap, clearCookie } from "./auth.mjs";
import { handleUpload, handleDownload } from "./files.mjs";
import { registerAuth } from "./routes/auth.mjs";
import { registerStaff } from "./routes/staff.mjs";
import { registerAdmin } from "./routes/admin.mjs";

const routes = [];
const compile = (p) => new RegExp("^" + p.replace(/:[a-z]+/gi, "([^/]+)") + "/?$");
const names = (p) => [...p.matchAll(/:([a-z]+)/gi)].map((m) => m[1]);
const reg = (method) => (path, handler, auth = "ready") => routes.push({ method, re: compile(path), names: names(path), handler, auth });
export const r = { get: reg("GET"), post: reg("POST"), put: reg("PUT"), patch: reg("PATCH"), delete: reg("DELETE") };

r.get("/api/health", async () => {
  const b = await bootstrap();
  return { ok: true, setup: b.ready ? "ready" : "setup_required", problem: b.problem || undefined,
    app_secret: !!process.env.APP_SECRET && process.env.APP_SECRET.length >= 24 };
}, "public");
r.post("/api/files", (ctx) => handleUpload(ctx), "ready");
r.get("/api/files/:id", (ctx) => handleDownload(ctx, ctx.params.id), "ready");
registerAuth(r); registerStaff(r); registerAdmin(r);

let booted = false;
export async function handle(req) {
  const url = new URL(req.url);
  try {
    if (!booted) { const b = await bootstrap(); if (b.ready) booted = true; }
    const match = routes.find((rt) => rt.method === req.method && rt.re.test(url.pathname));
    if (!match) throw new HttpError(404, "Not found");
    const m = url.pathname.match(match.re);
    const params = Object.fromEntries(match.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    const ip = (req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const ctx = { req, url, params, ip, ua: req.headers.get("user-agent") || "", query: Object.fromEntries(url.searchParams), user: null, body: {} };

    if (!["GET", "HEAD"].includes(req.method)) {
      if (req.headers.get("x-requested-with") !== "bg") throw new HttpError(403, "Invalid request");
      const origin = req.headers.get("origin");
      if (origin && new URL(origin).host !== url.host) throw new HttpError(403, "Invalid origin");
    }
    if (match.auth !== "public") {
      const a = await authenticate(req);
      if (!a) return json({ error: "Please sign in" }, 401, { "set-cookie": clearCookie() });
      ctx.user = a.user; ctx.sessionId = a.sessionId;
      if (match.auth !== "user" && ctx.user.must_change_password) throw new HttpError(403, "Password change required", { code: "must_change_password" });
      if (match.auth === "admin" && ctx.user.role !== "superadmin") throw new HttpError(403, "Administrator access required");
      if (match.auth === "staff" && ctx.user.role !== "staff") throw new HttpError(403, "Staff access required");
    }
    const ct = req.headers.get("content-type") || "";
    if (!["GET", "HEAD"].includes(req.method) && ct.includes("application/json")) {
      const text = await req.text();
      if (text.length > 1_000_000) throw new HttpError(413, "Request too large");
      try { ctx.body = text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, "Invalid JSON"); }
      if (ctx.body === null || typeof ctx.body !== "object" || Array.isArray(ctx.body)) throw new HttpError(400, "Invalid JSON body");
    }
    const out = await match.handler(ctx);
    if (out instanceof Response) return out;
    return json(out ?? { ok: true }, 200, ctx.setCookie ? { "set-cookie": ctx.setCookie } : {});
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status);
    if (e?.code === "23505") return json({ error: "That record already exists" }, 409);
    if (e?.code === "23503") return json({ error: "Related record not found" }, 400);
    if (e?.code === "23514" || e?.code === "22P02" || e?.code === "22007" || e?.code === "22003") return json({ error: "Invalid value supplied" }, 400);
    console.error("API error", req.method, url.pathname, e?.message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}
