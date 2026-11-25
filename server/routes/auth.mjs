import { query, one } from "../db.mjs";
import { attemptLogin, sessionCookie, clearCookie, hashPassword, verifyPassword } from "../auth.mjs";
import { passwordProblem, newTotpSecret, encrypt, decrypt, verifyTotp, newRecoveryCodes, sha256 } from "../security.mjs";
import { bad, HttpError, str, phToday } from "../util.mjs";
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
