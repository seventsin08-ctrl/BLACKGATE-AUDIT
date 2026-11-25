import { scrypt, randomBytes, timingSafeEqual, createHash, createHmac, createCipheriv, createDecipheriv } from "node:crypto";

const N = 16384, R = 8, P = 1, KEYLEN = 64;
const scryptP = (pw, salt, n, r, p) => new Promise((res, rej) =>
  scrypt(pw, salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 }, (e, k) => (e ? rej(e) : res(k))));

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scryptP(pw, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function verifyPassword(pw, stored) {
  try {
    const [alg, n, r, p, salt, key] = stored.split("$");
    if (alg !== "scrypt") return false;
    const k = await scryptP(pw, Buffer.from(salt, "base64"), +n, +r, +p);
    const expected = Buffer.from(key, "base64");
    return k.length === expected.length && timingSafeEqual(k, expected);
  } catch { return false; }
}
export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export function passwordProblem(pw, username = "") {
  if (typeof pw !== "string" || pw.length < 10) return "Password must be at least 10 characters";
  if (pw.length > 200) return "Password is too long";
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return "Password must include letters and numbers";
  if (username && pw.toLowerCase().includes(username.toLowerCase())) return "Password must not contain your username";
  if (/^(admin123|password|12345678)/i.test(pw)) return "That password is too common";
  return null;
}

// ---- secrets at rest (TOTP) ----
function key() {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 24) throw new Error("APP_SECRET is not configured");
  return createHash("sha256").update("bg-enc:" + s).digest();
}
export function encrypt(text) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
export function decrypt(blob) {
  const [iv, tag, enc] = blob.split(".").map((x) => Buffer.from(x, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// ---- TOTP (RFC 6238, SHA-1, 6 digits, 30s) ----
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(buf) {
  let bits = "", out = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}
export function unbase32(s) {
  let bits = "";
  for (const ch of s.replace(/=+$/, "")) bits += B32.indexOf(ch).toString(2).padStart(5, "0");
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
export const newTotpSecret = () => base32(randomBytes(20));
export function totp(secret, t = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = createHmac("sha1", unbase32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1_000_000;
  return String(code).padStart(6, "0");
}
export function verifyTotp(secret, code) {
  if (!/^\d{6}$/.test(String(code))) return false;
  const now = Date.now();
  return [-1, 0, 1].some((w) => {
    const a = Buffer.from(totp(secret, now + w * 30000)), b = Buffer.from(String(code));
    return timingSafeEqual(a, b);
  });
}
export function newRecoveryCodes(n = 8) {
  return Array.from({ length: n }, () => randomBytes(5).toString("hex").replace(/(.{5})(.{5})/, "$1-$2"));
}
