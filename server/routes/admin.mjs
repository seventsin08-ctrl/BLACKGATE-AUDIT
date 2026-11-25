import { query, one, tx } from "../db.mjs";
import { isReservedUsername, bad, forbidden, notFound, str, oneOf, int, cents, fromCents, dateStr, tsStr, checklist, phToday, addDays, randomPassword, randomToken, json } from "../util.mjs";
import { hashPassword, passwordProblem } from "../security.mjs";
import { notify, notifyMany, logActivity, recomputeCommission, spawnNextRecurrence, TASK_EFF } from "../services.mjs";
import { getSettings, setSetting, DEFAULTS } from "../settings.mjs";
import { computeRankings } from "../perf.mjs";
import { buildReport, csvResponse } from "../reports.mjs";
import { createBackup, listBackups, readBackup, restoreBackup, deleteBackup } from "../backup.mjs";
import { publicUser } from "./auth.mjs";
import { range } from "./staff.mjs";

const A = "admin";
const REPORT_TYPES = ["posts", "clients", "payments", "commissions", "tips", "bonuses", "tasks", "audits", "activity", "rankings", "platforms"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const staffUser = async (id) => {
  const u = await one("SELECT * FROM users WHERE id=$1 AND role='staff'", [int(id, "Staff id")]);
  if (!u) throw notFound("Staff member not found");
  return u;
};
const addFilter = (p, w, col, v, cast = (x) => x) => { if (v !== undefined && v !== "") { p.push(cast(v)); w.push(`${col}=$${p.length}`); } };

export function registerAdmin(r) {
  // ================= OVERVIEW =================
  r.get("/api/admin/overview", async () => {
    const today = phToday(), month = today.slice(0, 8) + "01";
    const [c] = await query(
      `SELECT (SELECT count(*)::int FROM users WHERE role='staff' AND status='active') AS active_staff,
        (SELECT count(*)::int FROM users WHERE role='staff' AND status='suspended') AS suspended_staff,
        (SELECT count(*)::int FROM users WHERE role='staff' AND status='pending') AS pending_signups,
        (SELECT count(*)::int FROM posts WHERE posted_on=$1 AND status IN ('pending','verified')) AS posts_today,
        (SELECT count(*)::int FROM posts WHERE status='pending') AS posts_pending,
        (SELECT count(*)::int FROM payments WHERE status='pending') AS payments_pending,
        (SELECT count(*)::int FROM tips WHERE status='pending') AS tips_pending,
        (SELECT count(*)::int FROM audits WHERE status='submitted') AS audits_pending,
        (SELECT count(*)::int FROM tasks WHERE status='under_review') AS tasks_review,
        (SELECT count(*)::int FROM tasks WHERE status IN ('not_started','in_progress') AND deadline < now()) AS tasks_overdue,
        (SELECT count(*)::int FROM clients WHERE confirmed_at IS NULL AND status<>'cancelled') AS clients_unconfirmed,
        (SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='verified' AND paid_on >= $2) AS revenue_month,
        (SELECT COALESCE(SUM(c.price) - COALESCE((SELECT SUM(amount) FROM payments p JOIN clients c2 ON c2.id=p.client_id WHERE p.status='verified' AND c2.status='active' AND c2.confirmed_at IS NOT NULL),0),0) FROM clients c WHERE c.status='active' AND c.confirmed_at IS NOT NULL) AS outstanding,
        (SELECT COALESCE(SUM(amount),0) FROM commissions WHERE status='eligible') AS commissions_eligible,
        (SELECT count(*)::int FROM commissions WHERE status='eligible') AS commissions_eligible_count,
        (SELECT COALESCE(SUM(amount),0) FROM commissions WHERE status='approved') AS commissions_approved`, [today, month]);
    const submittedToday = await query("SELECT user_id FROM audits WHERE audit_date=$1 AND status IN ('submitted','approved')", [today]);
    const rank = await computeRankings(addDays(today, -29), today);
    const recent = await query("SELECT id,created_at,actor_name,action,target_type,target_id FROM activity_logs ORDER BY id DESC LIMIT 8");
    return { today, counts: c, audits_missing_today: rank.staff.filter((s) => !submittedToday.some((a) => a.user_id === s.id)).map((s) => ({ id: s.id, name: s.full_name })),
      highlights: rank.highlights, top: rank.staff.slice(0, 5).map((s) => ({ id: s.id, name: s.full_name, score: s.score })), recent_activity: recent };
  }, A);

  // ================= STAFF MANAGEMENT =================
  r.get("/api/admin/staff", async (ctx) => {
    const rows = await query(
      `SELECT u.id,u.username,u.full_name,u.staff_code,u.position,u.responsibilities,u.status,u.joined_at,u.last_login_at,u.avatar_file,u.totp_enabled,u.must_change_password,
         (SELECT count(*)::int FROM posts WHERE user_id=u.id AND status IN ('pending','verified')) AS posts,
         (SELECT count(*)::int FROM posts WHERE user_id=u.id AND status='verified') AS verified_posts,
         (SELECT count(*)::int FROM clients WHERE user_id=u.id) AS clients,
         (SELECT count(*)::int FROM tasks WHERE assigned_to=u.id AND status IN ('not_started','in_progress') AND deadline < now()) AS overdue_tasks
       FROM users u WHERE u.role='staff' ORDER BY (u.status='pending') DESC, u.status, u.full_name`);
    return { staff: rows };
  }, A);
  r.post("/api/admin/staff", async (ctx) => {
    const b = ctx.body;
    const username = str(b.username, { req: true, max: 40, name: "Username" }).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw bad("Username may use letters, numbers, dot, dash and underscore (3–40 characters)");
    if (isReservedUsername(username)) throw bad("That username is reserved");
    const temp = b.password ? str(b.password, { max: 200 }) : randomPassword();
    if (b.password) { const prob = passwordProblem(temp, username); if (prob) throw bad(prob); }
    const row = await one(
      `INSERT INTO users(username,full_name,role,position,responsibilities,password_hash,must_change_password,joined_at)
       VALUES($1,$2,'staff',$3,$4,$5,TRUE,$6) RETURNING id`,
      [username, str(b.full_name, { req: true, max: 120, name: "Full name" }), str(b.position, { max: 120 }), str(b.responsibilities, { max: 2000 }),
        await hashPassword(temp), b.joined_at ? dateStr(b.joined_at, "Date joined") : phToday()]);
    const code = "BG-" + String(row.id).padStart(4, "0");
    await query("UPDATE users SET staff_code=$1 WHERE id=$2", [code, row.id]);
    await notify(row.id, "welcome", "Welcome to BlackGate", "Complete your profile and set up your platforms to get started.", "#/dashboard");
    await logActivity(ctx, "staff.created", "user", row.id, { username, staff_code: code });
    return { id: row.id, staff_code: code, username, temporary_password: temp };
  }, A);
  r.patch("/api/admin/staff/:id", async (ctx) => {
    const u = await staffUser(ctx.params.id), b = ctx.body, set = {};
    if ("full_name" in b) set.full_name = str(b.full_name, { req: true, max: 120, name: "Full name" });
    if ("position" in b) set.position = str(b.position, { max: 120 });
    if ("responsibilities" in b) set.responsibilities = str(b.responsibilities, { max: 2000 });
    if ("joined_at" in b) set.joined_at = dateStr(b.joined_at, "Date joined");
    const keys = Object.keys(set);
    if (keys.length) await query(`UPDATE users SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(",")} WHERE id=$1`, [u.id, ...Object.values(set)]);
    await logActivity(ctx, "staff.updated", "user", u.id, set);
    return { ok: true };
  }, A);
  r.post("/api/admin/staff/:id/suspend", async (ctx) => {
    const u = await staffUser(ctx.params.id);
    await query("UPDATE users SET status='suspended' WHERE id=$1", [u.id]);
    await query("UPDATE sessions SET revoked=TRUE WHERE user_id=$1", [u.id]);
    await logActivity(ctx, "staff.suspended", "user", u.id, { username: u.username });
    return { ok: true };
  }, A);
  r.post("/api/admin/staff/:id/approve", async (ctx) => {
    const u = await staffUser(ctx.params.id);
    if (u.status !== "pending") throw bad("This account is not waiting for approval");
    await query("UPDATE users SET status='active' WHERE id=$1", [u.id]);
    await notify(u.id, "welcome", "Your account was approved", "You can now use your workspace.", "#/dashboard");
    await logActivity(ctx, "staff.approved", "user", u.id, { username: u.username });
    return { ok: true };
  }, A);
  r.post("/api/admin/staff/:id/reactivate", async (ctx) => {
    const u = await staffUser(ctx.params.id);
    await query("UPDATE users SET status='active' WHERE id=$1", [u.id]);
    await logActivity(ctx, "staff.reactivated", "user", u.id, { username: u.username });
    return { ok: true };
  }, A);
  r.post("/api/admin/staff/:id/reset-password", async (ctx) => {
    const u = await staffUser(ctx.params.id), temp = randomPassword();
    await query("UPDATE users SET password_hash=$1, must_change_password=TRUE, totp_enabled=FALSE, totp_secret_enc=NULL, recovery_codes='[]' WHERE id=$2", [await hashPassword(temp), u.id]);
    await query("UPDATE sessions SET revoked=TRUE WHERE user_id=$1", [u.id]);
    await logActivity(ctx, "staff.password_reset", "user", u.id, { username: u.username });
    return { temporary_password: temp };
  }, A);
  r.post("/api/admin/staff/:id/revoke-sessions", async (ctx) => {
    const u = await staffUser(ctx.params.id);
    await query("UPDATE sessions SET revoked=TRUE WHERE user_id=$1", [u.id]);
    await logActivity(ctx, "staff.sessions_revoked", "user", u.id);
    return { ok: true };
  }, A);

  // ---- complete authorised work profile ----
  r.get("/api/admin/staff/:id/profile", async (ctx) => {
    const u = await staffUser(ctx.params.id), { from, to } = range(ctx.query), id = u.id;
    const [posts] = await query(
      `SELECT count(*) FILTER (WHERE status IN ('pending','verified'))::int AS total, count(*) FILTER (WHERE status='verified')::int AS verified,
              count(*) FILTER (WHERE status='duplicate')::int AS duplicates, count(*) FILTER (WHERE status='rejected')::int AS rejected
       FROM posts WHERE user_id=$1 AND posted_on BETWEEN $2 AND $3`, [id, from, to]);
    const [cl] = await query(
      `SELECT count(*)::int AS acquired, count(*) FILTER (WHERE confirmed_at IS NOT NULL)::int AS confirmed,
        COALESCE((SELECT SUM(py.amount) FROM payments py JOIN clients c2 ON c2.id=py.client_id WHERE c2.user_id=$1 AND py.status='verified' AND py.paid_on BETWEEN $2 AND $3),0) AS revenue,
        COALESCE(SUM(price) FILTER (WHERE status='active' AND confirmed_at IS NOT NULL),0) - COALESCE((SELECT SUM(py.amount) FROM payments py JOIN clients c3 ON c3.id=py.client_id WHERE c3.user_id=$1 AND c3.status='active' AND c3.confirmed_at IS NOT NULL AND py.status='verified'),0) AS outstanding
       FROM clients WHERE user_id=$1 AND acquired_on BETWEEN $2 AND $3`, [id, from, to]);
    const [tk] = await query(
      `SELECT count(*)::int AS assigned, count(*) FILTER (WHERE status='completed')::int AS completed,
        count(*) FILTER (WHERE status IN ('not_started','in_progress') AND deadline < now())::int AS overdue FROM tasks WHERE assigned_to=$1 AND parent_id IS NULL AND created_at::date BETWEEN $2 AND $3`, [id, from, to]);
    const platforms = await query(
      `SELECT pl.id, pl.kind, pl.name, pl.profile_name, pl.profile_url,
        (SELECT count(*)::int FROM posts p WHERE p.platform_id=pl.id AND p.status IN ('pending','verified')) AS posts,
        (SELECT count(*)::int FROM posts p WHERE p.platform_id=pl.id AND p.status='verified') AS verified_posts,
        (SELECT count(*)::int FROM clients c WHERE c.platform_id=pl.id) AS clients, (SELECT max(p.posted_on) FROM posts p WHERE p.platform_id=pl.id) AS last_activity
       FROM platforms pl WHERE pl.user_id=$1 ORDER BY pl.id`, [id]);
    const trend = await query(
      `SELECT d::date::text AS date,
        (SELECT count(*)::int FROM posts p WHERE p.user_id=$1 AND p.posted_on=d::date AND p.status IN ('pending','verified')) AS posts,
        (SELECT count(*)::int FROM posts p WHERE p.user_id=$1 AND p.posted_on=d::date AND p.status='verified') AS verified,
        (SELECT count(*)::int FROM audits a WHERE a.user_id=$1 AND a.audit_date=d::date AND a.status IN ('submitted','approved')) AS audits
       FROM generate_series($2::date, $3::date, interval '1 day') d ORDER BY d`, [id, from, to]);
    const rank = await computeRankings(from, to);
    return {
      profile: { ...publicUser(u), dashboard_layout: undefined, created_at: u.created_at }, from, to,
      stats: { posts, clients: { ...cl, conversion_percent: cl.acquired ? Math.round((cl.confirmed / cl.acquired) * 100) : 0 }, tasks: tk },
      ranking: rank.staff.find((s) => s.id === id) || null, platforms, trend,
      audits: await query("SELECT id,audit_date,status,revision,submitted_at,review_note FROM audits WHERE user_id=$1 AND audit_date BETWEEN $2 AND $3 ORDER BY audit_date DESC", [id, from, to]),
      commissions: await query("SELECT m.*, c.name AS client_name FROM commissions m JOIN clients c ON c.id=m.client_id WHERE m.user_id=$1 ORDER BY m.id DESC", [id]),
      tips: await query("SELECT * FROM tips WHERE user_id=$1 ORDER BY id DESC LIMIT 100", [id]),
      bonuses: await query("SELECT * FROM bonuses WHERE user_id=$1 ORDER BY id DESC LIMIT 100", [id]),
      tasks: await query(`SELECT t.id,t.title,t.kind,t.priority,t.deadline,t.status,${TASK_EFF} AS effective_status,t.completed_at FROM tasks t WHERE t.assigned_to=$1 AND t.parent_id IS NULL ORDER BY t.created_at DESC LIMIT 100`, [id]),
      shared_notes: await query("SELECT id,title,body,checklist,category,updated_at,task_id,client_id FROM notes WHERE user_id=$1 AND type='work' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100", [id]),
      logins: await query("SELECT success,reason,ip,user_agent,created_at FROM login_events WHERE user_id=$1 ORDER BY id DESC LIMIT 20", [id]),
    };
  }, A);

  // ================= DAILY AUDITS =================
  r.get("/api/admin/audits", async (ctx) => {
    const { from, to } = range(ctx.query), p = [from, to], w = ["a.audit_date BETWEEN $1 AND $2"];
    addFilter(p, w, "a.user_id", ctx.query.user, Number);
    if (ctx.query.status) addFilter(p, w, "a.status", oneOf(ctx.query.status, ["draft", "submitted", "approved", "correction_requested"]));
    return { audits: await query(
      `SELECT a.id,a.audit_date,a.status,a.revision,a.submitted_at,a.reviewed_at,u.full_name AS staff,u.id AS user_id,(a.snapshot->>'total_posts')::int AS posts
       FROM audits a JOIN users u ON u.id=a.user_id WHERE ${w.join(" AND ")} ORDER BY a.audit_date DESC, a.id DESC LIMIT 500`, p) };
  }, A);
  r.get("/api/admin/audits/:id", async (ctx) => {
    const a = await one("SELECT a.*, u.full_name AS staff, u.staff_code FROM audits a JOIN users u ON u.id=a.user_id WHERE a.id=$1", [int(ctx.params.id, "id")]);
    if (!a) throw notFound();
    return { audit: a, revisions: await query("SELECT revision,status,saved_at FROM audit_revisions WHERE audit_id=$1 ORDER BY id DESC", [a.id]) };
  }, A);
  async function reviewAudit(ctx, status) {
    const a = await one("SELECT * FROM audits WHERE id=$1", [int(ctx.params.id, "id")]);
    if (!a) throw notFound();
    if (a.status !== "submitted") throw bad("Only submitted audits can be reviewed");
    const note = str(ctx.body.note, { max: 1000, req: status === "correction_requested", name: "Correction note" });
    await query("UPDATE audits SET status=$2, reviewed_by=$3, reviewed_at=now(), review_note=$4 WHERE id=$1", [a.id, status, ctx.user.id, note]);
    await notify(a.user_id, status === "approved" ? "audit_approved" : "audit_correction", status === "approved" ? "Audit approved" : "Audit correction requested", status === "approved" ? `Your audit for ${a.audit_date} was approved.` : note, "#/audit");
    await logActivity(ctx, "audit." + status, "audit", a.id, { date: a.audit_date });
    return { ok: true };
  }
  r.post("/api/admin/audits/:id/approve", (ctx) => reviewAudit(ctx, "approved"), A);
  r.post("/api/admin/audits/:id/request-correction", (ctx) => reviewAudit(ctx, "correction_requested"), A);

  // ================= TASKS =================
  r.get("/api/admin/tasks", async (ctx) => {
    const p = [], w = ["t.parent_id IS NULL"];
    addFilter(p, w, "t.assigned_to", ctx.query.user, Number);
    if (ctx.query.kind) addFilter(p, w, "t.kind", oneOf(ctx.query.kind, ["personal", "official"]));
    if (ctx.query.q) { p.push("%" + ctx.query.q.slice(0, 100) + "%"); w.push(`t.title ILIKE $${p.length}`); }
    let sql = `SELECT t.*, ${TASK_EFF} AS effective_status, u.full_name AS staff FROM tasks t JOIN users u ON u.id=t.assigned_to WHERE ${w.join(" AND ")}`;
    if (ctx.query.status) { p.push(oneOf(ctx.query.status, ["not_started", "in_progress", "under_review", "completed", "overdue", "cancelled"])); sql = `SELECT * FROM (${sql}) x WHERE effective_status=$${p.length}`; }
    return { tasks: await query(sql + " ORDER BY created_at DESC LIMIT 500", p) };
  }, A);
  r.post("/api/admin/tasks", async (ctx) => {
    const b = ctx.body;
    const ids = (Array.isArray(b.assignees) ? b.assignees : [b.assignee]).map(Number).filter(Number.isInteger);
    if (!ids.length || ids.length > 50) throw bad("Choose at least one staff member");
    const staff = await query("SELECT id FROM users WHERE role='staff' AND status='active' AND id = ANY($1::int[])", [ids]);
    if (staff.length !== new Set(ids).size) throw bad("One or more selected staff members are not active");
    const group = randomToken(8), created = [];
    const title = str(b.title, { req: true, max: 200, name: "Title" });
    for (const s of staff) {
      const row = await one(
        `INSERT INTO tasks(title,description,assigned_to,created_by,kind,group_id,deadline,priority,category,recurrence,requires_evidence,checklist)
         VALUES($1,$2,$3,$4,'official',$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING id`,
        [title, str(b.description, { max: 4000 }), s.id, ctx.user.id, group, tsStr(b.deadline), oneOf(b.priority, PRIORITIES, "Priority", "normal"),
          str(b.category, { max: 60 }), oneOf(b.recurrence, ["none", "daily", "weekly"], "Recurrence", "none"), !!b.requires_evidence, JSON.stringify(checklist(b.checklist))]);
      created.push(row.id);
      await notify(s.id, "task_assigned", "New task assigned", title, "#/tasks");
    }
    await logActivity(ctx, "task.assigned", "task", created.join(","), { title, assignees: staff.map((s) => s.id) });
    return { created };
  }, A);
  r.patch("/api/admin/tasks/:id", async (ctx) => {
    const t = await one("SELECT * FROM tasks WHERE id=$1 AND kind='official'", [int(ctx.params.id, "id")]);
    if (!t) throw notFound();
    const b = ctx.body, set = {};
    if ("title" in b) set.title = str(b.title, { req: true, max: 200 });
    if ("description" in b) set.description = str(b.description, { max: 4000 });
    if ("deadline" in b) set.deadline = tsStr(b.deadline);
    if ("priority" in b) set.priority = oneOf(b.priority, PRIORITIES);
    if ("category" in b) set.category = str(b.category, { max: 60 });
    if ("requires_evidence" in b) set.requires_evidence = !!b.requires_evidence;
    const keys = Object.keys(set);
    if (keys.length) await query(`UPDATE tasks SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(",")} WHERE id=$1`, [t.id, ...Object.values(set)]);
    await logActivity(ctx, "task.updated", "task", t.id);
    return { ok: true };
  }, A);
  r.post("/api/admin/tasks/:id/verify", async (ctx) => {
    const t = await one("SELECT * FROM tasks WHERE id=$1 AND kind='official'", [int(ctx.params.id, "id")]);
    if (!t) throw notFound();
    if (t.status !== "under_review") throw bad("Only tasks under review can be verified");
    await query("UPDATE tasks SET status='completed', verified_at=now(), verified_by=$2, review_note='' WHERE id=$1", [t.id, ctx.user.id]);
    await notify(t.assigned_to, "task_verified", "Task verified", t.title, "#/tasks");
    await spawnNextRecurrence(t);
    await logActivity(ctx, "task.verified", "task", t.id);
    return { ok: true };
  }, A);
  r.post("/api/admin/tasks/:id/request-correction", async (ctx) => {
    const t = await one("SELECT * FROM tasks WHERE id=$1 AND kind='official'", [int(ctx.params.id, "id")]);
    if (!t) throw notFound();
    if (t.status !== "under_review") throw bad("Only tasks under review can be sent back");
    const note = str(ctx.body.note, { req: true, max: 1000, name: "Correction note" });
    await query("UPDATE tasks SET status='in_progress', completed_at=NULL, review_note=$2 WHERE id=$1", [t.id, note]);
    await notify(t.assigned_to, "task_correction", "Task needs changes", `${t.title}: ${note}`, "#/tasks");
    await logActivity(ctx, "task.correction_requested", "task", t.id);
    return { ok: true };
  }, A);
  r.post("/api/admin/tasks/:id/cancel", async (ctx) => {
    const t = await one("SELECT * FROM tasks WHERE id=$1 AND kind='official'", [int(ctx.params.id, "id")]);
    if (!t) throw notFound();
    await query("UPDATE tasks SET status='cancelled' WHERE id=$1", [t.id]);
    await notify(t.assigned_to, "task_cancelled", "Task cancelled", t.title, "#/tasks");
    await logActivity(ctx, "task.cancelled", "task", t.id);
    return { ok: true };
  }, A);

  // ================= POSTING RECORDS =================
  r.get("/api/admin/posts", async (ctx) => {
    const { from, to } = range(ctx.query), p = [from, to], w = ["p.posted_on BETWEEN $1 AND $2"];
    addFilter(p, w, "p.user_id", ctx.query.user, Number);
    addFilter(p, w, "pl.kind", ctx.query.platform);
    if (ctx.query.status) addFilter(p, w, "p.status", oneOf(ctx.query.status, ["pending", "verified", "rejected", "duplicate"]));
    return { posts: await query(
      `SELECT p.*, u.full_name AS staff, COALESCE(pl.name,'') AS platform_name, COALESCE(pl.kind,'') AS platform_kind FROM posts p JOIN users u ON u.id=p.user_id
       LEFT JOIN platforms pl ON pl.id=p.platform_id WHERE ${w.join(" AND ")} ORDER BY p.id DESC LIMIT 1000`, p) };
  }, A);
  r.post("/api/admin/posts/review", async (ctx) => {
    const ids = (ctx.body.ids || []).map(Number).filter(Number.isInteger).slice(0, 500);
    if (!ids.length) throw bad("Select at least one post");
    const action = oneOf(ctx.body.action, ["verify", "reject", "reset"], "Action");
    const note = str(ctx.body.note, { max: 500 });
    const posts = await query("SELECT * FROM posts WHERE id = ANY($1::int[])", [ids]);
    let changed = 0, skipped = 0;
    for (const p of posts) {
      if (action === "verify") {
        if (p.status !== "pending") { skipped++; continue; }
        const [d] = await query("SELECT id FROM posts WHERE url_norm=$1 AND status='verified' AND id<>$2 LIMIT 1", [p.url_norm, p.id]);
        if (d) { await query("UPDATE posts SET status='duplicate', duplicate_of=$2 WHERE id=$1", [p.id, d.id]); skipped++; continue; }
        await query("UPDATE posts SET status='verified', verified_by=$2, verified_at=now(), review_note=$3 WHERE id=$1", [p.id, ctx.user.id, note]);
      } else if (action === "reject") {
        if (!["pending", "verified"].includes(p.status)) { skipped++; continue; }
        await query("UPDATE posts SET status='rejected', verified_by=$2, verified_at=now(), review_note=$3 WHERE id=$1", [p.id, ctx.user.id, note]);
      } else {
        if (!["verified", "rejected"].includes(p.status)) { skipped++; continue; }
        await query("UPDATE posts SET status='pending', verified_by=NULL, verified_at=NULL WHERE id=$1", [p.id]);
      }
      changed++;
    }
    await logActivity(ctx, "posts." + action, "post", ids.slice(0, 20).join(","), { changed, skipped });
    return { changed, skipped };
  }, A);

  // ================= PLATFORMS =================
  r.get("/api/admin/platforms", async (ctx) => {
    const { from, to } = range(ctx.query);
    const rk = await computeRankings(from, to);
    const accounts = await query(
      `SELECT pl.id, pl.kind, pl.name, pl.profile_name, pl.profile_url, u.full_name AS staff,
        (SELECT count(*)::int FROM posts p WHERE p.platform_id=pl.id AND p.status IN ('pending','verified') AND p.posted_on BETWEEN $1 AND $2) AS posts,
        (SELECT count(*)::int FROM posts p WHERE p.platform_id=pl.id AND p.status='verified' AND p.posted_on BETWEEN $1 AND $2) AS verified_posts,
        (SELECT count(*)::int FROM clients c WHERE c.platform_id=pl.id) AS clients, (SELECT max(p.posted_on) FROM posts p WHERE p.platform_id=pl.id) AS last_activity
       FROM platforms pl JOIN users u ON u.id=pl.user_id ORDER BY pl.kind, u.full_name`, [from, to]);
    return { platforms: rk.platforms, accounts, best: rk.highlights.best_platform, from, to };
  }, A);

  // ================= CLIENTS =================
  r.get("/api/admin/clients", async (ctx) => {
    const p = [], w = ["TRUE"];
    addFilter(p, w, "c.user_id", ctx.query.user, Number);
    if (ctx.query.status) addFilter(p, w, "c.status", oneOf(ctx.query.status, ["active", "completed", "cancelled"]));
    if (ctx.query.confirmed === "1") w.push("c.confirmed_at IS NOT NULL");
    if (ctx.query.confirmed === "0") w.push("c.confirmed_at IS NULL");
    if (ctx.query.q) { p.push("%" + ctx.query.q.slice(0, 100) + "%"); w.push(`(c.name ILIKE $${p.length} OR c.service ILIKE $${p.length})`); }
    return { clients: await query(
      `SELECT c.*, u.full_name AS staff, pl.name AS platform_name,
         COALESCE((SELECT SUM(amount) FROM payments WHERE client_id=c.id AND status='verified'),0) AS verified_paid,
         COALESCE((SELECT SUM(amount) FROM payments WHERE client_id=c.id AND status='pending'),0) AS pending_paid,
         (SELECT status FROM commissions WHERE client_id=c.id) AS commission_status
       FROM clients c JOIN users u ON u.id=c.user_id LEFT JOIN platforms pl ON pl.id=c.platform_id WHERE ${w.join(" AND ")} ORDER BY c.id DESC LIMIT 500`, p) };
  }, A);
  r.get("/api/admin/clients/:id", async (ctx) => {
    const c = await one("SELECT c.*, u.full_name AS staff FROM clients c JOIN users u ON u.id=c.user_id WHERE c.id=$1", [int(ctx.params.id, "id")]);
    if (!c) throw notFound();
    return { client: c, payments: await query("SELECT * FROM payments WHERE client_id=$1 ORDER BY id", [c.id]), commission: await one("SELECT * FROM commissions WHERE client_id=$1", [c.id]) };
  }, A);
  r.patch("/api/admin/clients/:id", async (ctx) => {
    const c = await one("SELECT * FROM clients WHERE id=$1", [int(ctx.params.id, "id")]);
    if (!c) throw notFound();
    const b = ctx.body, set = {};
    if ("name" in b) set.name = str(b.name, { req: true, max: 150 });
    if ("service" in b) set.service = str(b.service, { max: 300 });
    if ("contact" in b) set.contact = str(b.contact, { max: 200 });
    if ("notes" in b) set.notes = str(b.notes, { max: 4000 });
    if ("status" in b) set.status = oneOf(b.status, ["active", "completed", "cancelled"]);
    if ("price" in b) {
      const priceC = cents(b.price, "Project price");
      const [paid] = await query("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE client_id=$1 AND status<>'rejected'", [c.id]);
      if (priceC < Math.round(parseFloat(paid.s) * 100)) throw bad("Price cannot be lower than payments already recorded");
      const [com] = await query("SELECT status FROM commissions WHERE client_id=$1", [c.id]);
      if (com && ["approved", "released"].includes(com.status)) throw bad("Price cannot change after the commission is approved");
      set.price = fromCents(priceC);
    }
    const keys = Object.keys(set);
    if (keys.length) await query(`UPDATE clients SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(",")} WHERE id=$1`, [c.id, ...Object.values(set)]);
    await recomputeCommission(c.id);
    await logActivity(ctx, "client.updated", "client", c.id, set);
    return { ok: true };
  }, A);
  r.post("/api/admin/clients/:id/confirm", async (ctx) => {
    const c = await one("SELECT * FROM clients WHERE id=$1", [int(ctx.params.id, "id")]);
    if (!c) throw notFound();
    await query("UPDATE clients SET confirmed_at=COALESCE(confirmed_at,now()), confirmed_by=$2 WHERE id=$1", [c.id, ctx.user.id]);
    await notify(c.user_id, "client_confirmed", "Client confirmed", c.name, "#/clients");
    await logActivity(ctx, "client.confirmed", "client", c.id);
    return { ok: true };
  }, A);
  r.post("/api/admin/clients/:id/unconfirm", async (ctx) => {
    const c = await one("SELECT * FROM clients WHERE id=$1", [int(ctx.params.id, "id")]);
    if (!c) throw notFound();
    await query("UPDATE clients SET confirmed_at=NULL, confirmed_by=NULL WHERE id=$1", [c.id]);
    await logActivity(ctx, "client.unconfirmed", "client", c.id);
    return { ok: true };
  }, A);

  // ================= PAYMENTS =================
  r.get("/api/admin/payments", async (ctx) => {
    const p = [], w = ["TRUE"];
    addFilter(p, w, "p.user_id", ctx.query.user, Number);
    if (ctx.query.status) addFilter(p, w, "p.status", oneOf(ctx.query.status, ["pending", "verified", "rejected"]));
    return { payments: await query(
      `SELECT p.*, u.full_name AS staff, c.name AS client, c.price AS client_price FROM payments p JOIN users u ON u.id=p.user_id JOIN clients c ON c.id=p.client_id
       WHERE ${w.join(" AND ")} ORDER BY (p.status='pending') DESC, p.id DESC LIMIT 500`, p) };
  }, A);
  async function reviewPayment(ctx, status) {
    const p = await one("SELECT p.*, c.name AS client_name, c.user_id AS owner FROM payments p JOIN clients c ON c.id=p.client_id WHERE p.id=$1", [int(ctx.params.id, "id")]);
    if (!p) throw notFound();
    if (status === "pending") {
      if (p.status === "pending") throw bad("Already pending");
      const [com] = await query("SELECT status FROM commissions WHERE client_id=$1", [p.client_id]);
      if (com && ["approved", "released"].includes(com.status)) throw bad("Cannot reverse: the commission is already approved");
    } else if (p.status !== "pending") throw bad("This payment has already been reviewed");
    const note = str(ctx.body.note, { max: 500, req: status === "rejected", name: "Reason" });
    await query("UPDATE payments SET status=$2, verified_by=$3, verified_at=CASE WHEN $2='verified' THEN now() END, review_note=$4 WHERE id=$1", [p.id, status, ctx.user.id, note]);
    if (status === "verified" && p.kind === "initial")
      await query("UPDATE clients SET confirmed_at=COALESCE(confirmed_at,now()), confirmed_by=COALESCE(confirmed_by,$2) WHERE id=$1", [p.client_id, ctx.user.id]);
    await recomputeCommission(p.client_id);
    if (status !== "pending") await notify(p.user_id, status === "verified" ? "payment_verified" : "payment_rejected",
      status === "verified" ? "Payment verified" : "Payment rejected", `${p.client_name} · ₱${p.amount}${note ? " · " + note : ""}`, "#/clients");
    await logActivity(ctx, "payment." + status, "payment", p.id, { client: p.client_name, amount: p.amount });
    return { ok: true };
  }
  r.post("/api/admin/payments/:id/verify", (ctx) => reviewPayment(ctx, "verified"), A);
  r.post("/api/admin/payments/:id/reject", (ctx) => reviewPayment(ctx, "rejected"), A);
  r.post("/api/admin/payments/:id/unverify", (ctx) => reviewPayment(ctx, "pending"), A);

  // ================= COMMISSIONS =================
  r.get("/api/admin/commissions", async (ctx) => {
    const p = [], w = ["TRUE"];
    addFilter(p, w, "m.user_id", ctx.query.user, Number);
    if (ctx.query.status) addFilter(p, w, "m.status", oneOf(ctx.query.status, ["locked", "eligible", "approved", "released", "void"]));
    return { commissions: await query(
      `SELECT m.*, u.full_name AS staff, c.name AS client, c.price AS client_price,
         COALESCE((SELECT SUM(amount) FROM payments WHERE client_id=c.id AND status='verified'),0) AS verified_paid
       FROM commissions m JOIN users u ON u.id=m.user_id JOIN clients c ON c.id=m.client_id WHERE ${w.join(" AND ")} ORDER BY m.id DESC LIMIT 500`, p) };
  }, A);
  r.post("/api/admin/commissions/:id/approve", async (ctx) => {
    const m = await one("SELECT m.*, c.name FROM commissions m JOIN clients c ON c.id=m.client_id WHERE m.id=$1", [int(ctx.params.id, "id")]);
    if (!m) throw notFound();
    if (m.status !== "eligible") throw bad("Only eligible commissions can be approved. The client must be fully paid and verified.");
    // re-validate server-side before approving
    const fresh = await recomputeCommission(m.client_id);
    if (!fresh || fresh.status !== "eligible") throw bad("This commission is no longer eligible");
    await query("UPDATE commissions SET status='approved', approved_by=$2, approved_at=now(), updated_at=now() WHERE id=$1", [m.id, ctx.user.id]);
    await notify(m.user_id, "commission_approved", "Commission approved", `${m.name}: ₱${m.amount}`, "#/earnings");
    await logActivity(ctx, "commission.approved", "commission", m.id, { amount: m.amount, staff: m.user_id });
    return { ok: true };
  }, A);
  r.post("/api/admin/commissions/:id/release", async (ctx) => {
    const m = await one("SELECT m.*, c.name FROM commissions m JOIN clients c ON c.id=m.client_id WHERE m.id=$1", [int(ctx.params.id, "id")]);
    if (!m) throw notFound();
    if (m.status !== "approved") throw bad("Approve the commission before recording a payout");
    await query("UPDATE commissions SET status='released', released_by=$2, released_at=now(), payout_method=$3, payout_ref=$4, updated_at=now() WHERE id=$1",
      [m.id, ctx.user.id, str(ctx.body.method, { max: 60, req: true, name: "Payout method" }), str(ctx.body.ref, { max: 120 })]);
    await notify(m.user_id, "commission_released", "Commission released", `${m.name}: ₱${m.amount}`, "#/earnings");
    await logActivity(ctx, "commission.released", "commission", m.id, { amount: m.amount, staff: m.user_id });
    return { ok: true };
  }, A);

  // ================= TIPS & BONUSES =================
  r.get("/api/admin/tips", async (ctx) => {
    const p = [], w = ["TRUE"];
    addFilter(p, w, "t.user_id", ctx.query.user, Number);
    if (ctx.query.status) addFilter(p, w, "t.status", oneOf(ctx.query.status, ["pending", "verified", "rejected", "released"]));
    return { tips: await query(`SELECT t.*, u.full_name AS staff, c.name AS client FROM tips t JOIN users u ON u.id=t.user_id LEFT JOIN clients c ON c.id=t.client_id WHERE ${w.join(" AND ")} ORDER BY t.id DESC LIMIT 500`, p),
      bonuses: await query("SELECT b.*, u.full_name AS staff FROM bonuses b JOIN users u ON u.id=b.user_id ORDER BY b.id DESC LIMIT 300") };
  }, A);
  async function tipAction(ctx, from, to) {
    const t = await one("SELECT * FROM tips WHERE id=$1", [int(ctx.params.id, "id")]);
    if (!t) throw notFound();
    if (!from.includes(t.status)) throw bad(`Tip is ${t.status}`);
    await query("UPDATE tips SET status=$2, verified_by=COALESCE(verified_by,$3), verified_at=COALESCE(verified_at,now()), released_at=CASE WHEN $2='released' THEN now() END WHERE id=$1", [t.id, to, ctx.user.id]);
    await notify(t.user_id, "tip_" + to, `Tip ${to}`, `₱${t.amount}`, "#/earnings");
    await logActivity(ctx, "tip." + to, "tip", t.id, { amount: t.amount });
    return { ok: true };
  }
  r.post("/api/admin/tips/:id/verify", (ctx) => tipAction(ctx, ["pending"], "verified"), A);
  r.post("/api/admin/tips/:id/reject", (ctx) => tipAction(ctx, ["pending"], "rejected"), A);
  r.post("/api/admin/tips/:id/release", (ctx) => tipAction(ctx, ["verified"], "released"), A);
  r.post("/api/admin/bonuses", async (ctx) => {
    const u = await staffUser(ctx.body.user_id), amount = cents(ctx.body.amount, "Bonus amount");
    const row = await one("INSERT INTO bonuses(user_id,amount,reason,awarded_by) VALUES($1,$2,$3,$4) RETURNING id", [u.id, fromCents(amount), str(ctx.body.reason, { req: true, max: 300, name: "Reason" }), ctx.user.id]);
    await notify(u.id, "bonus", "You received a bonus", `₱${fromCents(amount)} · ${ctx.body.reason}`, "#/earnings");
    await logActivity(ctx, "bonus.awarded", "bonus", row.id, { staff: u.id, amount: fromCents(amount) });
    return { id: row.id };
  }, A);
  r.post("/api/admin/bonuses/:id/release", async (ctx) => {
    const b = await one("SELECT * FROM bonuses WHERE id=$1", [int(ctx.params.id, "id")]);
    if (!b) throw notFound();
    if (b.status !== "awarded") throw bad("Bonus already released");
    await query("UPDATE bonuses SET status='released', released_at=now(), payout_ref=$2 WHERE id=$1", [b.id, str(ctx.body.ref, { max: 120 })]);
    await logActivity(ctx, "bonus.released", "bonus", b.id, { amount: b.amount });
    return { ok: true };
  }, A);

  // ================= RANKINGS & REPORTS =================
  r.get("/api/admin/rankings", async (ctx) => { const { from, to } = range(ctx.query); return computeRankings(from, to); }, A);
  r.get("/api/admin/reports/:type", async (ctx) => {
    if (!REPORT_TYPES.includes(ctx.params.type)) throw notFound();
    const { from, to } = range(ctx.query);
    const userId = ctx.query.user ? int(ctx.query.user, "Staff") : null;
    const report = await buildReport(ctx.params.type, { from, to, userId });
    if (ctx.query.format === "csv") {
      await logActivity(ctx, "report.exported", "report", ctx.params.type, { from, to, userId });
      return csvResponse(ctx.params.type, report);
    }
    return { ...report, rows: report.rows.slice(0, 200), total: report.rows.length, from, to };
  }, A);

  // ================= ANNOUNCEMENTS =================
  r.get("/api/admin/announcements", async () => ({
    announcements: await query("SELECT a.*, (SELECT count(*)::int FROM users WHERE role='staff' AND status='active') AS staff_count FROM announcements a ORDER BY id DESC LIMIT 100"),
  }), A);
  r.post("/api/admin/announcements", async (ctx) => {
    const b = ctx.body, title = str(b.title, { req: true, max: 150, name: "Title" }), body = str(b.body, { req: true, max: 4000, name: "Message" });
    let recipients = null, targets;
    if (b.audience === "selected") {
      recipients = (b.recipients || []).map(Number).filter(Number.isInteger);
      if (!recipients.length) throw bad("Choose at least one recipient");
      targets = await query("SELECT id FROM users WHERE role='staff' AND status='active' AND id = ANY($1::int[])", [recipients]);
      if (!targets.length) throw bad("No active recipients found");
      recipients = targets.map((t) => t.id);
    } else targets = await query("SELECT id FROM users WHERE role='staff' AND status='active'");
    const row = await one("INSERT INTO announcements(title,body,recipients,created_by) VALUES($1,$2,$3::int[],$4) RETURNING id", [title, body, recipients, ctx.user.id]);
    await notifyMany(targets.map((t) => t.id), "announcement", title, body.slice(0, 200), "#/announcements");
    await logActivity(ctx, "announcement.sent", "announcement", row.id, { title, audience: recipients ? "selected" : "all", count: targets.length });
    return { id: row.id, delivered: targets.length };
  }, A);
  r.delete("/api/admin/announcements/:id", async (ctx) => {
    await query("DELETE FROM announcements WHERE id=$1", [int(ctx.params.id, "id")]);
    await logActivity(ctx, "announcement.deleted", "announcement", ctx.params.id);
    return { ok: true };
  }, A);

  // ================= ACTIVITY LOGS =================
  r.get("/api/admin/logs", async (ctx) => {
    const { from, to } = range(ctx.query), p = [from, to], w = ["created_at::date BETWEEN $1 AND $2"];
    if (ctx.query.q) { p.push("%" + ctx.query.q.slice(0, 80) + "%"); w.push(`(action ILIKE $${p.length} OR actor_name ILIKE $${p.length} OR detail::text ILIKE $${p.length})`); }
    return { logs: await query(`SELECT * FROM activity_logs WHERE ${w.join(" AND ")} ORDER BY id DESC LIMIT 500`, p),
      logins: await query("SELECT l.id,l.username,l.success,l.reason,l.ip,l.user_agent,l.created_at FROM login_events l WHERE l.created_at::date BETWEEN $1 AND $2 ORDER BY l.id DESC LIMIT 200", [from, to]) };
  }, A);

  // ================= SETTINGS =================
  r.get("/api/admin/settings", async () => ({ settings: await getSettings(), defaults: DEFAULTS }), A);
  r.put("/api/admin/settings", async (ctx) => {
    const b = ctx.body, changed = {};
    const num = (k, min, max, label) => { if (k in b) { const v = Number(b[k]); if (!Number.isFinite(v) || v < min || v > max) throw bad(`${label} must be between ${min} and ${max}`); changed[k] = v; } };
    if ("signup_mode" in b) changed.signup_mode = oneOf(b.signup_mode, ["open", "approval", "closed"], "Sign-up mode");
    num("commission_percent", 0, 100, "Commission rate");
    num("daily_post_target", 0, 1000, "Daily post target");
    num("audit_reminder_hour", 0, 23, "Audit reminder hour");
    num("session_idle_minutes", 5, 1440, "Idle timeout");
    num("session_max_hours", 1, 72, "Session length");
    if ("working_days" in b) {
      if (!Array.isArray(b.working_days) || !b.working_days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) || !b.working_days.length) throw bad("Working days are invalid");
      changed.working_days = [...new Set(b.working_days)].sort();
    }
    for (const k of ["weights", "platform_weights"]) if (k in b) {
      const base = DEFAULTS[k], v = {};
      for (const key of Object.keys(base)) { const n = Number(b[k][key]); if (!Number.isFinite(n) || n < 0 || n > 1000) throw bad(`Invalid ${k}.${key}`); v[key] = n; }
      if (k === "weights" && Object.values(v).every((n) => n === 0)) throw bad("At least one weight must be above zero");
      changed[k] = v;
    }
    for (const [k, v] of Object.entries(changed)) await setSetting(k, v);
    await logActivity(ctx, "settings.updated", "settings", null, changed);
    return { settings: await getSettings() };
  }, A);

  // ================= BACKUP & RECOVERY =================
  r.get("/api/admin/backups", async () => ({ backups: await listBackups() }), A);
  r.post("/api/admin/backups", async (ctx) => {
    const b = await createBackup("manual", ctx.user.username);
    await logActivity(ctx, "backup.created", "backup", b.key);
    return b;
  }, A);
  r.get("/api/admin/backups/:key/download", async (ctx) => {
    const text = await readBackup(ctx.params.key);
    await logActivity(ctx, "backup.downloaded", "backup", ctx.params.key);
    return new Response(text, { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="blackgate-backup-${ctx.params.key}.json"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  }, A);
  r.post("/api/admin/backups/:key/restore", async (ctx) => {
    if (ctx.body.confirm !== "RESTORE") throw bad('Type RESTORE to confirm');
    await logActivity(ctx, "backup.restore_started", "backup", ctx.params.key);
    const out = await restoreBackup(ctx.params.key);
    await logActivity(null, "backup.restored", "backup", ctx.params.key, { by: ctx.user.username });
    return out;
  }, A);
  r.delete("/api/admin/backups/:key", async (ctx) => {
    await deleteBackup(ctx.params.key);
    await logActivity(ctx, "backup.deleted", "backup", ctx.params.key);
    return { ok: true };
  }, A);
}
