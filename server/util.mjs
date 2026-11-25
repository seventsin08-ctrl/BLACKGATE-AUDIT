import { randomBytes } from "node:crypto";

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
export const bad = (m) => new HttpError(400, m);
export const forbidden = (m = "Not allowed") => new HttpError(403, m);
export const notFound = (m = "Not found") => new HttpError(404, m);

export const SEC_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-frame-options": "DENY",
  "cache-control": "no-store",
};
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8", ...SEC_HEADERS, ...headers },
  });
}

export function str(v, { max = 500, req = false, name = "Field" } = {}) {
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string") throw bad(`${name} must be text`);
  v = v.trim();
  if (req && !v) throw bad(`${name} is required`);
  if (v.length > max) throw bad(`${name} is too long (max ${max})`);
  return v;
}
export function oneOf(v, list, name = "Value", def) {
  if ((v === undefined || v === null || v === "") && def !== undefined) return def;
  if (!list.includes(v)) throw bad(`${name} must be one of: ${list.join(", ")}`);
  return v;
}
export function int(v, name = "Value", { min = -2147483648, max = 2147483647, nullable = false } = {}) {
  if ((v === undefined || v === null || v === "") && nullable) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} is invalid`);
  return n;
}
/** Money in cents (integer) from number/string; max 100M. */
export function cents(v, name = "Amount", { allowZero = false } = {}) {
  if (v === undefined || v === null || v === "") throw bad(`${name} is required`);
  const s = String(v).replace(/[,₱\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw bad(`${name} must be a valid amount`);
  const c = Math.round(parseFloat(s) * 100);
  if (c > 10_000_000_000) throw bad(`${name} is too large`);
  if (c === 0 && !allowZero) throw bad(`${name} must be greater than zero`);
  return c;
}
export const fromCents = (c) => (c / 100).toFixed(2);
export function dateStr(v, name = "Date", { nullable = false } = {}) {
  if ((v === undefined || v === null || v === "") && nullable) return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) throw bad(`${name} must be a valid date`);
  return v;
}
export function tsStr(v, name = "Date/time", { nullable = true } = {}) {
  if ((v === undefined || v === null || v === "") && nullable) return null;
  const d = new Date(v);
  if (isNaN(d)) throw bad(`${name} is invalid`);
  return d.toISOString();
}
export function checklist(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 100) throw bad("Checklist is invalid");
  return v.map((i) => ({ text: str(i?.text, { max: 300, name: "Checklist item" }), done: !!i?.done })).filter((i) => i.text);
}
export const randomToken = (n = 32) => randomBytes(n).toString("base64url");
export function randomPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const b = randomBytes(14);
  let s = ""; for (const x of b) s += alphabet[x % alphabet.length];
  return s.slice(0, 4) + "-" + s.slice(4, 9) + "-" + s.slice(9, 14);
}

/** Normalise a post URL for duplicate detection. */
export function normUrl(u) {
  try {
    const x = new URL(u.trim());
    if (!/^https?:$/.test(x.protocol)) return null;
    let host = x.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, "");
    const drop = /^(utm_|fbclid|igshid|gclid|si$|ref|mibextid)/i;
    const keep = [...x.searchParams.entries()].filter(([k]) => !drop.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const qs = keep.length ? "?" + keep.map(([k, v]) => `${k}=${v}`).join("&") : "";
    const path = x.pathname.replace(/\/+$/, "") || "";
    return host + path + qs;
  } catch { return null; }
}
export function validUrl(u) { return normUrl(u) !== null && u.length <= 2000; }

/** CSV with formula-injection protection. */
export function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) v = v.toISOString();
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\r\n");
}
export const phToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
export const addDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

const RESERVED = ["admin", "superadmin", "administrator", "root", "blackgate", "system"];
/** Usernames staff can never take (administrator names, including the configured one). */
export const isReservedUsername = (u) => RESERVED.includes(u) || u === String(process.env.ADMIN_INITIAL_USERNAME || "").toLowerCase();
