import { query, one } from "./db.mjs";
import { hashPassword, verifyPassword, sha256, decrypt, verifyTotp } from "./security.mjs";
import { randomToken, HttpError } from "./util.mjs";
import { getSettings } from "./settings.mjs";
import { logActivity } from "./services.mjs";

export const COOKIE = "bg_session";

/** Create the single Superadmin from server-side env vars; handle documented recovery reset. */
export async function bootstrap() {
  const pw = process.env.ADMIN_INITIAL_PASSWORD;
  const uname = (process.env.ADMIN_INITIAL_USERNAME || "admin").toLowerCase();
  const admin = await one("SELECT * FROM users WHERE role='superadmin'");
  if (!admin) {
    if (!pw) return { ready: false, problem: "ADMIN_INITIAL_PASSWORD is not configured" };
    await query(
      `INSERT INTO users(username,full_name,role,staff_code,position,password_hash,must_change_password)
       VALUES($1,'Superadmin','superadmin','BG-OWNER','Owner',$2,TRUE) ON CONFLICT DO NOTHING`, [uname, await hashPassword(pw)]);
    await logActivity(null, "superadmin.initialized", "user", uname);
    return { ready: true };
  }
  const token = process.env.ADMIN_RECOVERY_RESET;
  if (token && pw) {
    const done = await one("SELECT value FROM settings WHERE key='recovery_reset_done'");
    if (!done || done.value !== sha256(token)) {
      await query(
        "UPDATE users SET password_hash=$1, must_change_password=TRUE, totp_enabled=FALSE, totp_secret_enc=NULL, recovery_codes='[]', status='active' WHERE id=$2",
        [await hashPassword(pw), admin.id]);
      // The reset also applies the configured Superadmin username (skipped if another account already uses it).
      if (uname !== admin.username && /^[a-z0-9._-]{3,40}$/.test(uname)) {
        const taken = await one("SELECT 1 FROM users WHERE username=$1 AND id<>$2", [uname, admin.id]);
        if (!taken) await query("UPDATE users SET username=$1 WHERE id=$2", [uname, admin.id]);
        else await logActivity(null, "superadmin.rename_skipped", "user", admin.id, { reason: "username in use" });
      }
      await query("UPDATE sessions SET revoked=TRUE WHERE user_id=$1", [admin.id]);
      await query(`INSERT INTO settings(key,value) VALUES('recovery_reset_done',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify(sha256(token))]);
      await logActivity(null, "superadmin.recovery_reset", "user", admin.id);
    }
  }
  return { ready: true };
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
export const sessionCookie = (token, maxAgeSec) =>
  `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
export const clearCookie = () => `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

export async function createSession(user, ip, ua) {
  const s = await getSettings();
  const token = randomToken(32);
  const maxSec = s.session_max_hours * 3600;
  await query(
    "INSERT INTO sessions(user_id,token_hash,ip,user_agent,expires_at) VALUES($1,$2,$3,$4, now() + ($5 || ' seconds')::interval)",
    [user.id, sha256(token), ip, (ua || "").slice(0, 300), String(maxSec)]);
  return { token, maxSec };
}

export async function authenticate(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const row = await one(
    `SELECT s.id AS sid, s.last_seen, s.expires_at, s.revoked, u.*
     FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1`, [sha256(token)]);
  if (!row || row.revoked || row.status !== "active") return null;
  const settings = await getSettings();
  const now = Date.now();
  if (new Date(row.expires_at).getTime() < now) return null;
  if (now - new Date(row.last_seen).getTime() > settings.session_idle_minutes * 60000) {
    await query("UPDATE sessions SET revoked=TRUE WHERE id=$1", [row.sid]);
    return null;
  }
  if (now - new Date(row.last_seen).getTime() > 60000) await query("UPDATE sessions SET last_seen=now() WHERE id=$1", [row.sid]);
  const { sid, last_seen, expires_at, revoked, ...user } = row;
  return { user, sessionId: sid };
}

export async function checkRateLimit(username, ip) {
  const [a] = await query("SELECT count(*)::int c FROM login_events WHERE NOT success AND ip=$1 AND created_at > now() - interval '15 minutes'", [ip]);
  const [b] = await query("SELECT count(*)::int c FROM login_events WHERE NOT success AND username=$1 AND ip=$2 AND created_at > now() - interval '15 minutes'", [username, ip]);
  const [c] = await query("SELECT count(*)::int c FROM login_events WHERE NOT success AND username=$1 AND created_at > now() - interval '15 minutes'", [username]);
  if (a.c >= 20 || b.c >= 5 || c.c >= 30)
    throw new HttpError(429, "Too many failed attempts. Try again in 15 minutes.");
}
export async function recordLogin(userId, username, success, reason, ip, ua) {
  await query("INSERT INTO login_events(user_id,username,success,reason,ip,user_agent) VALUES($1,$2,$3,$4,$5,$6)",
    [userId, (username || "").slice(0, 100), success, reason, ip, (ua || "").slice(0, 300)]);
}
const DUMMY = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

export async function attemptLogin({ username, password, otp, portal }, ip, ua) {
  username = String(username || "").trim().toLowerCase().slice(0, 100);
  if (!username || typeof password !== "string") throw new HttpError(400, "Username and password are required");
  await checkRateLimit(username, ip);
  const user = await one("SELECT * FROM users WHERE username=$1", [username]);
  const ok = await verifyPassword(password, user ? user.password_hash : DUMMY);
  if (!user || !ok) { await recordLogin(user?.id ?? null, username, false, "bad_credentials", ip, ua); throw new HttpError(401, "Invalid username or password"); }
  // Separate sign-in portals: administrator and staff credentials only work on their own page.
  if (portal === "admin" && user.role !== "superadmin" || portal === "staff" && user.role === "superadmin") {
    await recordLogin(user.id, username, false, "wrong_portal", ip, ua);
    throw new HttpError(401, "Invalid username or password");
  }
  if (user.status === "pending") { await recordLogin(user.id, username, false, "pending", ip, ua); throw new HttpError(403, "Your account is waiting for administrator approval."); }
  if (user.status !== "active") { await recordLogin(user.id, username, false, "suspended", ip, ua); throw new HttpError(403, "This account is suspended. Contact the administrator."); }
  if (user.totp_enabled) {
    if (!otp) return { needs_otp: true };
    let good = false;
    const code = String(otp).trim();
    if (/^\d{6}$/.test(code)) good = verifyTotp(decrypt(user.totp_secret_enc), code);
    else {
      const hashes = user.recovery_codes || [];
      const h = sha256(code.toLowerCase());
      if (hashes.includes(h)) {
        good = true;
        await query("UPDATE users SET recovery_codes=$2::jsonb WHERE id=$1", [user.id, JSON.stringify(hashes.filter((x) => x !== h))]);
      }
    }
    if (!good) { await recordLogin(user.id, username, false, "bad_otp", ip, ua); throw new HttpError(401, "Invalid verification code"); }
  }
  await query("UPDATE users SET last_login_at=now() WHERE id=$1", [user.id]);
  await recordLogin(user.id, username, true, "ok", ip, ua);
  const { token, maxSec } = await createSession(user, ip, ua);
  return { user, token, maxSec };
}
export { hashPassword, verifyPassword };
