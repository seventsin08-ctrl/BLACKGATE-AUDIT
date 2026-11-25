import { query, one } from "../db.mjs";
import { attemptLogin, sessionCookie, clearCookie, hashPassword, verifyPassword } from "../auth.mjs";
import { passwordProblem, newTotpSecret, encrypt, decrypt, verifyTotp, newRecoveryCodes, sha256 } from "../security.mjs";
import { bad, HttpError, str, phToday, isReservedUsername } from "../util.mjs";
import { createSession } from "../auth.mjs";
import { notifyMany } from "../services.mjs";
import { ownFile } from "../files.mjs";
import { logActivity } from "../services.mjs";
import { getSettings } from "../settings.mjs";

export const publicUser = (u) => ({
  id: u.id, username: u.username, full_name: u.full_name, role: u.role, staff_code: u.staff_code,
  position: u.position, responsibilities: u.responsibilities, avatar_file: u.avatar_file, status: u.status,
  joined_at: u.joined_at, last_login_at: u.last_login_at, totp_enabled: u.totp_enabled,
  must_change_password: u.must_change_password, dashboard_layout: u.dashboard_layout,
});

export function registerAuth(r) {
  r.post("/api/auth/login", async (ctx) => {
    const res = await attemptLogin(ctx.body, ctx.ip, ctx.ua);
    if (res.needs_otp) return { needs_otp: true };
    ctx.setCookie = sessionCookie(res.token, res.maxSec);
    return { user: publicUser(res.user), today: phToday() };
  }, "public");

  r.get("/api/auth/config", async () => ({ signup_mode: (await getSettings()).signup_mode }), "public");

  // Staff self-registration (admin accounts can never be created here).
  r.post("/api/auth/register", async (ctx) => {
    const s = await getSettings();
    if (s.signup_mode === "closed") throw new HttpError(403, "New account sign-ups are currently closed. Contact the administrator.");
    const [n] = await query("SELECT count(*)::int c FROM login_events WHERE reason='signup' AND ip=$1 AND created_at > now() - interval '1 hour'", [ctx.ip]);
    if (n.c >= 5) throw new HttpError(429, "Too many sign-ups from this network. Try again later.");
    const b = ctx.body;
    const full_name = str(b.full_name, { req: true, max: 120, name: "Full name" });
    const username = str(b.username, { req: true, max: 40, name: "Username" }).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw bad("Username may use letters, numbers, dot, dash and underscore (3–40 characters)");
    const problem = passwordProblem(b.password, username); if (problem) throw bad(problem);
    if (b.password !== b.confirm) throw bad("Passwords do not match");
    const status = s.signup_mode === "approval" ? "pending" : "active";
    const exists = isReservedUsername(username) || await one("SELECT 1 FROM users WHERE username=$1", [username]);
    if (exists) throw new HttpError(409, "That username is already taken");
    const row = await one(
      `INSERT INTO users(username,full_name,role,position,password_hash,must_change_password,status,joined_at)
       VALUES($1,$2,'staff',$3,$4,FALSE,$5,$6) RETURNING *`,
      [username, full_name, str(b.position, { max: 120 }), await hashPassword(b.password), status, phToday()]);
    await query("UPDATE users SET staff_code=$1 WHERE id=$2", ["BG-" + String(row.id).padStart(4, "0"), row.id]);
    await query("INSERT INTO login_events(user_id,username,success,reason,ip,user_agent) VALUES($1,$2,TRUE,'signup',$3,$4)", [row.id, username, ctx.ip, ctx.ua.slice(0, 300)]);
    const admins = await query("SELECT id FROM users WHERE role='superadmin'");
    await notifyMany(admins.map((a) => a.id), "signup", status === "pending" ? "Sign-up awaiting approval" : "New staff sign-up", `${full_name} (@${username})`, "#/staff");
    await logActivity({ user: row, ip: ctx.ip }, "staff.self_registered", "user", row.id, { username, status });
    if (status === "pending") return { pending: true };
    const { token, maxSec } = await createSession(row, ctx.ip, ctx.ua);
    await query("UPDATE users SET last_login_at=now() WHERE id=$1", [row.id]);
    ctx.setCookie = sessionCookie(token, maxSec);
    return { user: publicUser({ ...row, staff_code: "BG-" + String(row.id).padStart(4, "0") }), pending: false };
  }, "public");

  r.post("/api/auth/logout", async (ctx) => {
    await query("UPDATE sessions SET revoked=TRUE WHERE id=$1", [ctx.sessionId]);
    ctx.setCookie = clearCookie();
    return { ok: true };
  }, "user");

  r.get("/api/auth/me", async (ctx) => {
    const s = await getSettings();
    return { user: publicUser(ctx.user), today: phToday(), settings: { daily_post_target: s.daily_post_target, commission_percent: s.commission_percent } };
  }, "user");

  r.post("/api/auth/change-password", async (ctx) => {
    const { current, next } = ctx.body;
    if (typeof current !== "string" || typeof next !== "string") throw bad("Current and new password are required");
    if (!(await verifyPassword(current, ctx.user.password_hash))) throw new HttpError(400, "Current password is incorrect");
    const problem = passwordProblem(next, ctx.user.username);
    if (problem) throw bad(problem);
    if (await verifyPassword(next, ctx.user.password_hash)) throw bad("New password must be different from the current one");
    await query("UPDATE users SET password_hash=$1, must_change_password=FALSE WHERE id=$2", [await hashPassword(next), ctx.user.id]);
    await query("UPDATE sessions SET revoked=TRUE WHERE user_id=$1 AND id<>$2", [ctx.user.id, ctx.sessionId]);
    await logActivity(ctx, "auth.password_changed", "user", ctx.user.id);
    return { ok: true };
  }, "user");

  r.post("/api/auth/avatar", async (ctx) => {
    const id = await ownFile(ctx.user.id, ctx.body.file_id, ["avatar"]);
    await query("UPDATE users SET avatar_file=$1 WHERE id=$2", [id, ctx.user.id]);
    return { ok: true, avatar_file: id };
  }, "ready");

  // ---- two-factor ----
  r.post("/api/auth/2fa/setup", async (ctx) => {
    if (ctx.user.totp_enabled) throw bad("Two-factor authentication is already enabled");
    const secret = newTotpSecret();
    await query("UPDATE users SET totp_secret_enc=$1 WHERE id=$2", [encrypt(secret), ctx.user.id]);
    const uri = `otpauth://totp/BlackGate:${encodeURIComponent(ctx.user.username)}?secret=${secret}&issuer=BlackGate`;
    return { secret, uri };
  });
  r.post("/api/auth/2fa/enable", async (ctx) => {
    if (!ctx.user.totp_secret_enc) throw bad("Start setup first");
    if (!verifyTotp(decrypt(ctx.user.totp_secret_enc), String(ctx.body.code || ""))) throw bad("That code is not correct");
    const codes = newRecoveryCodes();
    await query("UPDATE users SET totp_enabled=TRUE, recovery_codes=$2::jsonb WHERE id=$1", [ctx.user.id, JSON.stringify(codes.map((c) => sha256(c)))]);
    await logActivity(ctx, "auth.2fa_enabled", "user", ctx.user.id);
    return { recovery_codes: codes };
  });
  r.post("/api/auth/2fa/disable", async (ctx) => {
    if (!(await verifyPassword(String(ctx.body.password || ""), ctx.user.password_hash))) throw bad("Password is incorrect");
    await query("UPDATE users SET totp_enabled=FALSE, totp_secret_enc=NULL, recovery_codes='[]' WHERE id=$1", [ctx.user.id]);
    await logActivity(ctx, "auth.2fa_disabled", "user", ctx.user.id);
    return { ok: true };
  });

  // ---- sessions & history ----
  r.get("/api/auth/sessions", async (ctx) => ({
    current: ctx.sessionId,
    sessions: await query(
      `SELECT id, ip, user_agent, created_at, last_seen, expires_at FROM sessions
       WHERE user_id=$1 AND NOT revoked AND expires_at > now() ORDER BY last_seen DESC`, [ctx.user.id]),
  }));
  r.delete("/api/auth/sessions/:id", async (ctx) => {
    await query("UPDATE sessions SET revoked=TRUE WHERE id=$1 AND user_id=$2", [Number(ctx.params.id) || 0, ctx.user.id]);
    return { ok: true };
  });
  r.post("/api/auth/sessions/revoke-others", async (ctx) => {
    await query("UPDATE sessions SET revoked=TRUE WHERE user_id=$1 AND id<>$2", [ctx.user.id, ctx.sessionId]);
    return { ok: true };
  });
  r.get("/api/auth/history", async (ctx) => ({
    events: await query("SELECT success, reason, ip, user_agent, created_at FROM login_events WHERE user_id=$1 OR username=$2 ORDER BY created_at DESC LIMIT 50", [ctx.user.id, ctx.user.username]),
  }));
}
