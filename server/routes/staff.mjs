import { query, one, tx } from "../db.mjs";
import { bad, forbidden, notFound, str, oneOf, int, cents, fromCents, dateStr, tsStr, checklist, normUrl, validUrl, phToday, addDays } from "../util.mjs";
import { ownFile } from "../files.mjs";
import { notify, notifyMany, earningsFor, recomputeCommission, spawnNextRecurrence, TASK_EFF } from "../services.mjs";
import { getSettings } from "../settings.mjs";
import { computeRankings } from "../perf.mjs";
import { buildReport, csvResponse } from "../reports.mjs";

const PLATFORM_KINDS = ["Facebook", "Facebook Marketplace", "Facebook Groups", "Instagram", "TikTok", "LinkedIn", "Reddit", "Messenger", "Telegram", "Discord", "YouTube", "X", "Other"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const TASK_STATUSES = ["not_started", "in_progress", "under_review", "completed", "overdue", "cancelled"];
const REPORTS_STAFF = ["posts", "clients", "payments", "commissions", "tasks", "audits", "tips"];

async function ownRow(table, id, userId, col = "user_id") {
  const row = await one(`SELECT * FROM ${table} WHERE id=$1 AND ${col}=$2`, [int(id, "id"), userId]);
  if (!row) throw notFound();
  return row;
}
async function ownRef(table, id, userId) {
  if (id === null || id === undefined || id === "") return null;
  const row = await one(`SELECT id FROM ${table} WHERE id=$1 AND user_id=$2`, [int(id, "Reference"), userId]);
  if (!row) throw bad("Referenced record not found");
  return row.id;
}
const range = (q) => {
  const to = q.to ? dateStr(q.to, "To") : phToday();
  const from = q.from ? dateStr(q.from, "From") : addDays(to, -29);
  return { from, to };
};

// ---------- audit snapshot (server-computed from existing records) ----------
export async function auditSnapshot(userId, date) {
  const settings = await getSettings();
  const posts = await query(
    `SELECT p.id, p.url, p.status, pl.id AS platform_id, COALESCE(pl.name, 'Unassigned') AS platform
     FROM posts p LEFT JOIN platforms pl ON pl.id=p.platform_id
     WHERE p.user_id=$1 AND p.posted_on=$2 AND p.status<>'rejected' ORDER BY p.id`, [userId, date]);
  const byPlat = new Map(); let dupes = 0;
  for (const p of posts) {
    if (p.status === "duplicate") { dupes++; continue; }
    const k = p.platform_id ?? 0;
    if (!byPlat.has(k)) byPlat.set(k, { platform_id: p.platform_id, platform: p.platform, count: 0, links: [] });
    const e = byPlat.get(k); e.count++; e.links.push(p.url);
  }
  const acquired = await query(
    `SELECT c.id, c.name, c.service, c.price,
       COALESCE((SELECT SUM(amount) FROM payments WHERE client_id=c.id AND status<>'rejected'),0) AS paid
     FROM clients c WHERE c.user_id=$1 AND c.acquired_on=$2 ORDER BY c.id`, [userId, date]);
  const [pay] = await query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE kind='initial'),0) AS initial, COALESCE(SUM(amount) FILTER (WHERE kind='remaining'),0) AS remaining
     FROM payments WHERE user_id=$1 AND paid_on=$2 AND status<>'rejected'`, [userId, date]);
  const [tips] = await query("SELECT COALESCE(SUM(amount),0) AS total FROM tips WHERE user_id=$1 AND received_on=$2 AND status<>'rejected'", [userId, date]);
  const completed = await query(
    `SELECT id,title FROM tasks WHERE assigned_to=$1 AND status IN ('completed','under_review') AND (completed_at AT TIME ZONE 'Asia/Manila')::date=$2 ORDER BY id`, [userId, date]);
  const incomplete = await query(
    `SELECT id,title,status,deadline FROM tasks WHERE assigned_to=$1 AND status IN ('not_started','in_progress')
       AND (deadline IS NULL OR (deadline AT TIME ZONE 'Asia/Manila')::date <= $2) ORDER BY deadline NULLS LAST, id`, [userId, date]);
  const potentialC = Math.round(parseFloat(pay.initial) * 100 * settings.commission_percent / 100);
  return {
    date, posting: [...byPlat.values()], total_posts: [...byPlat.values()].reduce((a, b) => a + b.count, 0), duplicate_posts: dupes,
    clients: { acquired, count: acquired.length, initial_payments: pay.initial, remaining_payments_received: pay.remaining, tips: tips.total, potential_commission: fromCents(potentialC) },
    tasks: { completed, incomplete },
  };
}
function cleanManual(m = {}) {
  return {
    work_notes: str(m.work_notes, { max: 4000 }), problems: str(m.problems, { max: 4000 }),
    followups: str(m.followups, { max: 4000 }), plans: str(m.plans, { max: 4000 }),
    progress: str(m.progress, { max: 2000 }),
    screenshots: Array.isArray(m.screenshots) ? m.screenshots.slice(0, 10).map(String) : [],
  };
}

export function registerStaff(r) {
  const S = "staff";

  // ================= DASHBOARD =================
  r.get("/api/me/dashboard", async (ctx) => {
    const uid = ctx.user.id, today = phToday(), settings = await getSettings();
    const [posts] = await query(
      `SELECT count(*) FILTER (WHERE posted_on=$2 AND status IN ('pending','verified'))::int AS today,
              count(*) FILTER (WHERE status='verified')::int AS verified,
              count(*) FILTER (WHERE status IN ('pending','verified'))::int AS valid FROM posts WHERE user_id=$1`, [uid, today]);
    const [tasks] = await query(
      `SELECT count(*) FILTER (WHERE status NOT IN ('cancelled'))::int AS assigned,
              count(*) FILTER (WHERE status='completed')::int AS completed,
              count(*) FILTER (WHERE status IN ('not_started','in_progress','under_review') AND NOT (status IN ('not_started','in_progress') AND deadline < now()))::int AS pending,
              count(*) FILTER (WHERE status IN ('not_started','in_progress') AND deadline < now())::int AS overdue
       FROM tasks t WHERE assigned_to=$1 AND parent_id IS NULL`, [uid]);
    const [cl] = await query(
      `SELECT count(*) FILTER (WHERE status='active')::int AS active, count(*) FILTER (WHERE confirmed_at IS NOT NULL)::int AS acquired, count(*)::int AS total FROM clients WHERE user_id=$1`, [uid]);
    const audit = await one("SELECT status, audit_date FROM audits WHERE user_id=$1 AND audit_date=$2", [uid, today]);
    const platformActivity = await query(
      `SELECT COALESCE(pl.name,'Unassigned') AS platform, count(*)::int AS posts
       FROM posts p LEFT JOIN platforms pl ON pl.id=p.platform_id
       WHERE p.user_id=$1 AND p.posted_on >= $2 AND p.status IN ('pending','verified') GROUP BY 1 ORDER BY 2 DESC LIMIT 6`, [uid, addDays(today, -29)]);
    const upcoming = await query(
      `SELECT id,title,deadline,priority,${TASK_EFF} AS effective_status FROM tasks t
       WHERE assigned_to=$1 AND status IN ('not_started','in_progress') ORDER BY deadline NULLS LAST LIMIT 5`, [uid]);
    const notifications = await query("SELECT id,type,title,body,link,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 6", [uid]);
    const rank = await computeRankings(addDays(today, -29), today);
    const idx = rank.staff.findIndex((s) => s.id === uid);
    return {
      today, target: settings.daily_post_target, posts, tasks, clients: cl, audit: audit || { status: "not_started", audit_date: today },
      platform_activity: platformActivity, upcoming, notifications,
      earnings: await earningsFor(uid),
      rank: { position: idx >= 0 ? idx + 1 : null, of: rank.staff.length, score: idx >= 0 ? rank.staff[idx].score : 0 },
    };
  }, S);
  r.put("/api/me/layout", async (ctx) => {
    const l = ctx.body.layout;
    if (!Array.isArray(l) || l.length > 30) throw bad("Invalid layout");
    const clean = l.map((w) => ({ id: str(w.id, { max: 40 }), hidden: !!w.hidden }));
    await query("UPDATE users SET dashboard_layout=$1::jsonb WHERE id=$2", [JSON.stringify(clean), ctx.user.id]);
    return { ok: true };
  }, S);

  // ================= TASKS =================
  const taskSelect = `SELECT t.*, ${TASK_EFF} AS effective_status, c.name AS client_name, pl.name AS platform_name
    FROM tasks t LEFT JOIN clients c ON c.id=t.client_id LEFT JOIN platforms pl ON pl.id=t.platform_id`;
  r.get("/api/me/tasks", async (ctx) => {
    const q = ctx.query, p = [ctx.user.id]; let w = "t.assigned_to=$1";
    if (q.q) { p.push("%" + q.q.slice(0, 100) + "%"); w += ` AND (t.title ILIKE $${p.length} OR t.description ILIKE $${p.length})`; }
    if (q.priority) { p.push(oneOf(q.priority, PRIORITIES, "Priority")); w += ` AND t.priority=$${p.length}`; }
    if (q.category) { p.push(q.category.slice(0, 60)); w += ` AND t.category=$${p.length}`; }
    if (q.kind) { p.push(oneOf(q.kind, ["personal", "official"])); w += ` AND t.kind=$${p.length}`; }
    let sql = `${taskSelect} WHERE ${w}`;
    if (q.status) { p.push(oneOf(q.status, TASK_STATUSES, "Status")); sql = `SELECT * FROM (${taskSelect} WHERE ${w}) x WHERE effective_status=$${p.length}`; }
    return { tasks: await query(sql + " ORDER BY " + (q.status ? "" : "t.") + "created_at DESC LIMIT 500", p) };
  }, S);
  r.post("/api/me/tasks", async (ctx) => {
    const b = ctx.body, uid = ctx.user.id;
    let parent = null;
    if (b.parent_id) parent = await ownRow("tasks", b.parent_id, uid, "assigned_to");
    const row = await one(
      `INSERT INTO tasks(title,description,assigned_to,created_by,kind,parent_id,deadline,priority,category,client_id,platform_id,recurrence,requires_evidence,checklist)
       VALUES($1,$2,$3,$3,'personal',$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING id`,
      [str(b.title, { req: true, max: 200, name: "Title" }), str(b.description, { max: 4000 }), uid, parent?.id ?? null, tsStr(b.deadline),
        oneOf(b.priority, PRIORITIES, "Priority", "normal"), str(b.category, { max: 60 }), await ownRef("clients", b.client_id, uid), await ownRef("platforms", b.platform_id, uid),
        oneOf(b.recurrence, ["none", "daily", "weekly"], "Recurrence", "none"), !!b.requires_evidence, JSON.stringify(checklist(b.checklist))]);
    return { id: row.id };
  }, S);
  r.patch("/api/me/tasks/:id", async (ctx) => {
    const t = await ownRow("tasks", ctx.params.id, ctx.user.id, "assigned_to"), b = ctx.body, uid = ctx.user.id;
    if (["completed", "under_review", "cancelled"].includes(t.status) && t.kind === "official") throw forbidden("This task is locked");
    const set = {};
    if ("checklist" in b) set.checklist = JSON.stringify(checklist(b.checklist));
    if ("evidence_text" in b) set.evidence_text = str(b.evidence_text, { max: 4000 });
    if ("evidence_file" in b) set.evidence_file = await ownFile(uid, b.evidence_file);
    if ("status" in b) set.status = oneOf(b.status, t.kind === "personal" ? ["not_started", "in_progress", "cancelled"] : ["not_started", "in_progress"], "Status");
    if (t.kind === "personal") {
      if ("title" in b) set.title = str(b.title, { req: true, max: 200, name: "Title" });
      if ("description" in b) set.description = str(b.description, { max: 4000 });
      if ("deadline" in b) set.deadline = tsStr(b.deadline);
      if ("priority" in b) set.priority = oneOf(b.priority, PRIORITIES, "Priority");
      if ("category" in b) set.category = str(b.category, { max: 60 });
      if ("client_id" in b) set.client_id = await ownRef("clients", b.client_id, uid);
      if ("platform_id" in b) set.platform_id = await ownRef("platforms", b.platform_id, uid);
      if ("recurrence" in b) set.recurrence = oneOf(b.recurrence, ["none", "daily", "weekly"], "Recurrence");
      if ("requires_evidence" in b) set.requires_evidence = !!b.requires_evidence;
    }
    const keys = Object.keys(set);
    if (!keys.length) return { ok: true };
    await query(`UPDATE tasks SET ${keys.map((k, i) => `${k}=$${i + 3}${k === "checklist" ? "::jsonb" : ""}`).join(",")} WHERE id=$1 AND assigned_to=$2`, [t.id, uid, ...keys.map((k) => set[k])]);
    return { ok: true };
  }, S);
  r.post("/api/me/tasks/:id/complete", async (ctx) => {
    const t = await ownRow("tasks", ctx.params.id, ctx.user.id, "assigned_to"), b = ctx.body, uid = ctx.user.id;
    if (["completed", "under_review", "cancelled"].includes(t.status)) throw bad("This task cannot be completed again");
    const text = "evidence_text" in b ? str(b.evidence_text, { max: 4000 }) : t.evidence_text;
    const file = "evidence_file" in b ? await ownFile(uid, b.evidence_file) : t.evidence_file;
    if (t.requires_evidence && !text && !file) throw bad("Supporting evidence is required to complete this task");
    const status = t.kind === "official" ? "under_review" : "completed";
    await query("UPDATE tasks SET status=$3, completed_at=now(), evidence_text=$4, evidence_file=$5, review_note='' WHERE id=$1 AND assigned_to=$2", [t.id, uid, status, text, file]);
    if (t.kind === "official") {
      const admins = await query("SELECT id FROM users WHERE role='superadmin'");
      await notifyMany(admins.map((a) => a.id), "task_review", "Task awaiting review", `${ctx.user.full_name}: ${t.title}`, "#/tasks");
    } else await spawnNextRecurrence(t);
    return { ok: true, status };
  }, S);
  r.delete("/api/me/tasks/:id", async (ctx) => {
    const t = await ownRow("tasks", ctx.params.id, ctx.user.id, "assigned_to");
    if (t.kind !== "personal") throw forbidden("Official tasks can only be removed by the administrator");
    await query("DELETE FROM tasks WHERE id=$1", [t.id]);
    return { ok: true };
  }, S);

  // ================= NOTES =================
  r.get("/api/me/notes", async (ctx) => {
    const q = ctx.query, p = [ctx.user.id]; let w = "user_id=$1";
    const view = q.view || "all";
    if (view === "trash") w += " AND deleted_at IS NOT NULL";
    else { w += " AND deleted_at IS NULL"; w += view === "archived" ? " AND archived" : " AND NOT archived"; }
    if (view === "pinned") w += " AND pinned";
    if (q.folder) { p.push(int(q.folder, "Folder")); w += ` AND folder_id=$${p.length}`; }
    if (q.type) { p.push(oneOf(q.type, ["personal", "work"])); w += ` AND type=$${p.length}`; }
    if (q.category) { p.push(q.category.slice(0, 60)); w += ` AND category=$${p.length}`; }
    if (q.q) { p.push("%" + q.q.slice(0, 100) + "%"); w += ` AND (title ILIKE $${p.length} OR body ILIKE $${p.length})`; }
    const notes = await query(`SELECT * FROM notes WHERE ${w} ORDER BY pinned DESC, updated_at DESC LIMIT 500`, p);
    const folders = await query("SELECT f.*, (SELECT count(*)::int FROM notes n WHERE n.folder_id=f.id AND n.deleted_at IS NULL) AS count FROM note_folders f WHERE user_id=$1 ORDER BY name", [ctx.user.id]);
    return { notes, folders };
  }, S);
  async function noteFields(b, uid, partial) {
    const set = {};
    if (!partial || "title" in b) set.title = str(b.title, { max: 200 });
    if (!partial || "body" in b) set.body = str(b.body, { max: 50000 });
    if (!partial || "checklist" in b) set.checklist = JSON.stringify(checklist(b.checklist));
    if ("type" in b) set.type = oneOf(b.type, ["personal", "work"], "Type");
    if ("category" in b) set.category = str(b.category, { max: 60 });
    if ("pinned" in b) set.pinned = !!b.pinned;
    if ("archived" in b) set.archived = !!b.archived;
    if ("folder_id" in b) set.folder_id = b.folder_id ? (await ownRow("note_folders", b.folder_id, uid)).id : null;
    if ("task_id" in b) set.task_id = b.task_id ? (await ownRow("tasks", b.task_id, uid, "assigned_to")).id : null;
    if ("client_id" in b) set.client_id = await ownRef("clients", b.client_id, uid);
    return set;
  }
  r.post("/api/me/notes", async (ctx) => {
    const set = await noteFields(ctx.body, ctx.user.id, false);
    const keys = ["user_id", ...Object.keys(set)];
    const row = await one(`INSERT INTO notes(${keys.join(",")}) VALUES(${keys.map((k, i) => `$${i + 1}${k === "checklist" ? "::jsonb" : ""}`).join(",")}) RETURNING *`, [ctx.user.id, ...Object.values(set)]);
    return { note: row };
  }, S);
  r.patch("/api/me/notes/:id", async (ctx) => {
    const n = await ownRow("notes", ctx.params.id, ctx.user.id);
    if (n.deleted_at) throw bad("Restore this note before editing");
    const set = await noteFields(ctx.body, ctx.user.id, true);
    const keys = Object.keys(set);
    if (!keys.length) return { note: n };
    const row = await one(`UPDATE notes SET ${keys.map((k, i) => `${k}=$${i + 3}${k === "checklist" ? "::jsonb" : ""}`).join(",")}, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *`, [n.id, ctx.user.id, ...Object.values(set)]);
    return { note: row };
  }, S);
  r.delete("/api/me/notes/:id", async (ctx) => {
    const n = await ownRow("notes", ctx.params.id, ctx.user.id);
    if (n.deleted_at) await query("DELETE FROM notes WHERE id=$1", [n.id]);
    else await query("UPDATE notes SET deleted_at=now(), pinned=FALSE WHERE id=$1", [n.id]);
    return { ok: true };
  }, S);
  r.post("/api/me/notes/:id/restore", async (ctx) => {
    const n = await ownRow("notes", ctx.params.id, ctx.user.id);
    await query("UPDATE notes SET deleted_at=NULL, updated_at=now() WHERE id=$1", [n.id]);
    return { ok: true };
  }, S);
  r.post("/api/me/folders", async (ctx) => ({ folder: await one("INSERT INTO note_folders(user_id,name) VALUES($1,$2) RETURNING *", [ctx.user.id, str(ctx.body.name, { req: true, max: 60, name: "Folder name" })]) }), S);
  r.patch("/api/me/folders/:id", async (ctx) => {
    const f = await ownRow("note_folders", ctx.params.id, ctx.user.id);
    await query("UPDATE note_folders SET name=$2 WHERE id=$1", [f.id, str(ctx.body.name, { req: true, max: 60, name: "Folder name" })]);
    return { ok: true };
  }, S);
  r.delete("/api/me/folders/:id", async (ctx) => {
    const f = await ownRow("note_folders", ctx.params.id, ctx.user.id);
    await query("DELETE FROM note_folders WHERE id=$1", [f.id]);
    return { ok: true };
  }, S);

  // ================= PLATFORMS =================
  const platformStats = `SELECT pl.*,
      (SELECT count(*)::int FROM posts p WHERE p.platform_id=pl.id AND p.status IN ('pending','verified')) AS posts,
      (SELECT count(*)::int FROM posts p WHERE p.platform_id=pl.id AND p.status='verified') AS verified_posts,
      (SELECT count(*)::int FROM clients c WHERE c.platform_id=pl.id) AS clients,
      (SELECT count(*)::int FROM clients c WHERE c.platform_id=pl.id AND c.confirmed_at IS NOT NULL) AS confirmed_clients,
      (SELECT max(p.posted_on) FROM posts p WHERE p.platform_id=pl.id) AS last_activity
    FROM platforms pl`;
  function platformInput(b, partial) {
    const out = {};
    if (!partial || "kind" in b) out.kind = oneOf(b.kind, PLATFORM_KINDS, "Platform");
    if (!partial || "name" in b) out.name = str(b.name || b.kind, { req: true, max: 80, name: "Platform name" });
    if (!partial || "profile_name" in b) out.profile_name = str(b.profile_name, { max: 120 });
    if (!partial || "profile_url" in b) {
      const u = str(b.profile_url, { max: 500 });
      if (u && !validUrl(u)) throw bad("Profile URL must start with http:// or https://");
      out.profile_url = u;
    }
    if ("active" in b) out.active = !!b.active;
    return out;
  }
  r.get("/api/me/platforms", async (ctx) => ({ platforms: await query(platformStats + " WHERE pl.user_id=$1 ORDER BY pl.active DESC, pl.id", [ctx.user.id]), kinds: PLATFORM_KINDS }), S);
  r.post("/api/me/platforms", async (ctx) => {
    const v = platformInput(ctx.body, false); const keys = ["user_id", ...Object.keys(v)];
    const row = await one(`INSERT INTO platforms(${keys.join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING id`, [ctx.user.id, ...Object.values(v)]);
    return { id: row.id };
  }, S);
  r.patch("/api/me/platforms/:id", async (ctx) => {
    const pl = await ownRow("platforms", ctx.params.id, ctx.user.id); const v = platformInput(ctx.body, true); const keys = Object.keys(v);
    if (keys.length) await query(`UPDATE platforms SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(",")} WHERE id=$1`, [pl.id, ...Object.values(v)]);
    return { ok: true };
  }, S);
  r.delete("/api/me/platforms/:id", async (ctx) => {
    const pl = await ownRow("platforms", ctx.params.id, ctx.user.id);
    const [u] = await query("SELECT (SELECT count(*) FROM posts WHERE platform_id=$1)+(SELECT count(*) FROM clients WHERE platform_id=$1) AS n", [pl.id]);
    if (Number(u.n) > 0) throw bad("This platform has posts or clients. Deactivate it instead of deleting.");
    await query("DELETE FROM platforms WHERE id=$1", [pl.id]);
    return { ok: true };
  }, S);

  // ================= POSTS =================
  r.get("/api/me/posts", async (ctx) => {
    const { from, to } = range(ctx.query), p = [ctx.user.id, from, to]; let w = "p.user_id=$1 AND p.posted_on BETWEEN $2 AND $3";
    if (ctx.query.platform) { p.push(int(ctx.query.platform, "Platform")); w += ` AND p.platform_id=$${p.length}`; }
    if (ctx.query.status) { p.push(oneOf(ctx.query.status, ["pending", "verified", "rejected", "duplicate"])); w += ` AND p.status=$${p.length}`; }
    const posts = await query(`SELECT p.*, pl.name AS platform_name FROM posts p LEFT JOIN platforms pl ON pl.id=p.platform_id WHERE ${w} ORDER BY p.posted_on DESC, p.id DESC LIMIT 1000`, p);
    const summary = { total: posts.length, valid: posts.filter((x) => ["pending", "verified"].includes(x.status)).length, verified: posts.filter((x) => x.status === "verified").length, duplicates: posts.filter((x) => x.status === "duplicate").length, rejected: posts.filter((x) => x.status === "rejected").length };
    return { posts, summary, from, to };
  }, S);
  r.post("/api/me/posts", async (ctx) => {
    const b = ctx.body, uid = ctx.user.id;
    const raw = Array.isArray(b.urls) ? b.urls.join("\n") : str(b.links ?? b.url, { max: 200000, req: true, name: "Links" });
    const tokens = raw.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
    if (!tokens.length) throw bad("Paste at least one link");
    if (tokens.length > 200) throw bad("Maximum 200 links per submission");
    const platform = b.platform_id ? await ownRef("platforms", b.platform_id, uid) : null;
    const posted = b.posted_on ? dateStr(b.posted_on, "Posting date") : phToday();
    if (posted > phToday()) throw bad("Posting date cannot be in the future");
    const shot = await ownFile(uid, b.screenshot_file, ["screenshot"]);
    const title = str(b.title, { max: 300 }), campaign = str(b.campaign, { max: 120 });
    const invalid = [], seen = new Map(); const added = []; let dupes = 0;
    await tx(async (run) => {
      for (const url of tokens) {
        const norm = validUrl(url) ? normUrl(url) : null;
        if (!norm) { invalid.push(url.slice(0, 80)); continue; }
        let dupOf = seen.get(norm) ?? null;
        if (!dupOf) {
          const [ex] = await run("SELECT id FROM posts WHERE url_norm=$1 AND status IN ('pending','verified') ORDER BY id LIMIT 1", [norm]);
          dupOf = ex?.id ?? null;
        }
        const [row] = await run(
          `INSERT INTO posts(user_id,platform_id,url,url_norm,title,campaign,posted_on,screenshot_file,status,duplicate_of)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,status`,
          [uid, platform, url, norm, title, campaign, posted, shot, dupOf ? "duplicate" : "pending", dupOf]);
        if (dupOf) dupes++; else seen.set(norm, row.id);
        added.push(row.id);
      }
    });
    if (!added.length) throw bad("No valid links found. Links must start with http:// or https://");
    return { submitted: added.length, valid: added.length - dupes, duplicates: dupes, invalid };
  }, S);
  r.delete("/api/me/posts/:id", async (ctx) => {
    const p = await ownRow("posts", ctx.params.id, ctx.user.id);
    if (p.status === "verified") throw forbidden("Verified posts cannot be deleted");
    await query("DELETE FROM posts WHERE id=$1", [p.id]);
    return { ok: true };
  }, S);

  // ================= CLIENTS & PAYMENTS =================
  const clientSelect = `SELECT c.*, pl.name AS platform_name,
      COALESCE((SELECT SUM(amount) FROM payments WHERE client_id=c.id AND status='verified'),0) AS verified_paid,
      COALESCE((SELECT SUM(amount) FROM payments WHERE client_id=c.id AND status='pending'),0) AS pending_paid,
      (SELECT status FROM commissions WHERE client_id=c.id) AS commission_status,
      (SELECT amount FROM commissions WHERE client_id=c.id) AS commission_amount
    FROM clients c LEFT JOIN platforms pl ON pl.id=c.platform_id`;
  const withBalance = (c) => ({ ...c, balance: fromCents(Math.max(0, Math.round(c.price * 100) - Math.round(c.verified_paid * 100))) });
  r.get("/api/me/clients", async (ctx) => {
    const p = [ctx.user.id]; let w = "c.user_id=$1";
    if (ctx.query.q) { p.push("%" + ctx.query.q.slice(0, 100) + "%"); w += ` AND (c.name ILIKE $${p.length} OR c.service ILIKE $${p.length})`; }
    if (ctx.query.status) { p.push(oneOf(ctx.query.status, ["active", "completed", "cancelled"])); w += ` AND c.status=$${p.length}`; }
    return { clients: (await query(`${clientSelect} WHERE ${w} ORDER BY c.id DESC LIMIT 500`, p)).map(withBalance) };
  }, S);
  r.get("/api/me/clients/:id", async (ctx) => {
    await ownRow("clients", ctx.params.id, ctx.user.id);
    const [c] = await query(`${clientSelect} WHERE c.id=$1`, [Number(ctx.params.id)]);
    const payments = await query("SELECT * FROM payments WHERE client_id=$1 ORDER BY id", [c.id]);
    const tips = await query("SELECT * FROM tips WHERE client_id=$1 ORDER BY id", [c.id]);
    return { client: withBalance(c), payments, tips };
  }, S);
  r.post("/api/me/clients", async (ctx) => {
    const b = ctx.body, uid = ctx.user.id;
    const row = await one(
      `INSERT INTO clients(user_id,name,contact,platform_id,service,price,notes,acquired_on) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [uid, str(b.name, { req: true, max: 150, name: "Client name" }), str(b.contact, { max: 200 }), await ownRef("platforms", b.platform_id, uid),
        str(b.service, { max: 300 }), fromCents(b.price === undefined || b.price === "" ? 0 : cents(b.price, "Project price", { allowZero: true })),
        str(b.notes, { max: 4000 }), b.acquired_on ? dateStr(b.acquired_on) : phToday()]);
    return { id: row.id };
  }, S);
  r.patch("/api/me/clients/:id", async (ctx) => {
    const c = await ownRow("clients", ctx.params.id, ctx.user.id), b = ctx.body, set = {};
    if ("name" in b) set.name = str(b.name, { req: true, max: 150, name: "Client name" });
    if ("contact" in b) set.contact = str(b.contact, { max: 200 });
    if ("service" in b) set.service = str(b.service, { max: 300 });
    if ("notes" in b) set.notes = str(b.notes, { max: 4000 });
    if ("platform_id" in b) set.platform_id = await ownRef("platforms", b.platform_id, ctx.user.id);
    if ("price" in b) {
      const [n] = await query("SELECT count(*)::int n FROM payments WHERE client_id=$1 AND status<>'rejected'", [c.id]);
      if (n.n > 0) throw forbidden("Price is locked once payments are recorded. Ask the administrator to adjust it.");
      set.price = fromCents(cents(b.price, "Project price", { allowZero: true }));
    }
    if ("status" in b) set.status = oneOf(b.status, ["active", "completed"], "Status");
    const keys = Object.keys(set);
    if (keys.length) await query(`UPDATE clients SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(",")} WHERE id=$1`, [c.id, ...Object.values(set)]);
    return { ok: true };
  }, S);
  r.post("/api/me/clients/:id/payments", async (ctx) => {
    const c = await ownRow("clients", ctx.params.id, ctx.user.id), b = ctx.body, uid = ctx.user.id;
    if (c.status === "cancelled") throw bad("This client is cancelled");
    const kind = oneOf(b.kind, ["initial", "remaining"], "Payment type");
    const amountC = cents(b.amount, "Amount");
    const receipt = await ownFile(uid, b.receipt_file, ["receipt"]);
    const [agg] = await query(
      `SELECT COALESCE(SUM(amount),0) AS paid, count(*) FILTER (WHERE kind='initial')::int AS initials FROM payments WHERE client_id=$1 AND status<>'rejected'`, [c.id]);
    if (kind === "initial" && agg.initials > 0) throw bad("An initial payment is already recorded for this client");
    if (kind === "remaining" && agg.initials === 0) throw bad("Record the initial payment first");
    if (parseFloat(c.price) <= 0) throw bad("Set the project price before recording payments");
    if (Math.round(parseFloat(agg.paid) * 100) + amountC > Math.round(parseFloat(c.price) * 100)) throw bad("Payments cannot exceed the agreed project price");
    const row = await one(`INSERT INTO payments(client_id,user_id,kind,amount,paid_on,receipt_file,note) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [c.id, uid, kind, fromCents(amountC), b.paid_on ? dateStr(b.paid_on, "Payment date") : phToday(), receipt, str(b.note, { max: 500 })]);
    const admins = await query("SELECT id FROM users WHERE role='superadmin'");
    await notifyMany(admins.map((a) => a.id), "payment_submitted", "Payment awaiting verification", `${ctx.user.full_name} · ${c.name} · ₱${fromCents(amountC)}`, "#/payments");
    return { id: row.id };
  }, S);
  r.delete("/api/me/payments/:id", async (ctx) => {
    const p = await ownRow("payments", ctx.params.id, ctx.user.id);
    if (p.status !== "pending") throw forbidden("Only unverified payments can be removed");
    await query("DELETE FROM payments WHERE id=$1", [p.id]);
    return { ok: true };
  }, S);

  // ================= TIPS =================
  r.get("/api/me/tips", async (ctx) => ({ tips: await query("SELECT t.*, c.name AS client_name FROM tips t LEFT JOIN clients c ON c.id=t.client_id WHERE t.user_id=$1 ORDER BY t.id DESC LIMIT 300", [ctx.user.id]) }), S);
  r.post("/api/me/tips", async (ctx) => {
    const b = ctx.body, uid = ctx.user.id;
    const row = await one("INSERT INTO tips(user_id,client_id,amount,note,received_on,receipt_file) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
      [uid, await ownRef("clients", b.client_id, uid), fromCents(cents(b.amount, "Tip amount")), str(b.note, { max: 300 }), b.received_on ? dateStr(b.received_on) : phToday(), await ownFile(uid, b.receipt_file, ["receipt"])]);
    return { id: row.id };
  }, S);
  r.delete("/api/me/tips/:id", async (ctx) => {
    const t = await ownRow("tips", ctx.params.id, ctx.user.id);
    if (t.status !== "pending") throw forbidden("Only unverified tips can be removed");
    await query("DELETE FROM tips WHERE id=$1", [t.id]);
    return { ok: true };
  }, S);

  // ================= EARNINGS =================
  r.get("/api/me/earnings", async (ctx) => {
    const uid = ctx.user.id;
    const commissions = await query("SELECT m.*, c.name AS client_name, c.price AS client_price FROM commissions m JOIN clients c ON c.id=m.client_id WHERE m.user_id=$1 ORDER BY m.id DESC", [uid]);
    const payouts = await query(
      `SELECT 'commission' AS type, released_at AS at, amount, payout_method AS method, payout_ref AS ref, c.name AS label FROM commissions m JOIN clients c ON c.id=m.client_id WHERE m.user_id=$1 AND m.status='released'
       UNION ALL SELECT 'bonus', released_at, amount, '', payout_ref, reason FROM bonuses WHERE user_id=$1 AND status='released'
       UNION ALL SELECT 'tip', released_at, amount, '', '', note FROM tips WHERE user_id=$1 AND status='released'
       ORDER BY at DESC NULLS LAST`, [uid]);
    const bonuses = await query("SELECT * FROM bonuses WHERE user_id=$1 ORDER BY id DESC", [uid]);
    return { summary: await earningsFor(uid), commissions, payouts, bonuses };
  }, S);

  // ================= DAILY AUDIT =================
  const auditDate = (d) => {
    const date = d ? dateStr(d, "Audit date") : phToday();
    if (date > phToday()) throw bad("Audit date cannot be in the future");
    if (date < addDays(phToday(), -7)) throw bad("Audits can only be filed for the last 7 days");
    return date;
  };
  r.get("/api/me/audits", async (ctx) => ({ audits: await query("SELECT id,audit_date,status,revision,submitted_at,reviewed_at,review_note FROM audits WHERE user_id=$1 ORDER BY audit_date DESC LIMIT 120", [ctx.user.id]) }), S);
  r.get("/api/me/audits/prefill", async (ctx) => {
    const date = auditDate(ctx.query.date);
    const audit = await one("SELECT * FROM audits WHERE user_id=$1 AND audit_date=$2", [ctx.user.id, date]);
    const editable = !audit || ["draft", "correction_requested"].includes(audit.status);
    const live = await auditSnapshot(ctx.user.id, date);
    return { date, now: new Date().toISOString(), staff: { name: ctx.user.full_name, staff_code: ctx.user.staff_code },
      audit: audit ? { id: audit.id, status: audit.status, revision: audit.revision, review_note: audit.review_note, submitted_at: audit.submitted_at } : null,
      editable, snapshot: editable ? live : audit.snapshot, manual: audit?.manual || cleanManual({}) };
  }, S);
  async function saveAudit(ctx, submit) {
    const date = auditDate(ctx.params.date), uid = ctx.user.id;
    const manual = cleanManual(ctx.body.manual || {});
    for (const f of manual.screenshots) await ownFile(uid, f, ["screenshot"]);
    const existing = await one("SELECT * FROM audits WHERE user_id=$1 AND audit_date=$2", [uid, date]);
    if (existing && !["draft", "correction_requested"].includes(existing.status)) throw forbidden("This audit has been submitted and is locked");
    const snapshot = submit ? await auditSnapshot(uid, date) : null;
    if (submit && snapshot.total_posts === 0 && !manual.work_notes && !snapshot.clients.count && !snapshot.tasks.completed.length)
      throw bad("Nothing to submit yet. Add posts, clients, tasks or work notes first.");
    const status = submit ? "submitted" : (existing?.status === "correction_requested" ? "correction_requested" : "draft");
    const revision = existing ? existing.revision + (submit ? 1 : 0) : 1;
    const row = await one(
      `INSERT INTO audits(user_id,audit_date,status,manual,snapshot,revision,submitted_at)
       VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6, CASE WHEN $7 THEN now() END)
       ON CONFLICT(user_id,audit_date) DO UPDATE SET status=EXCLUDED.status, manual=EXCLUDED.manual, snapshot=COALESCE(EXCLUDED.snapshot, audits.snapshot),
         revision=EXCLUDED.revision, submitted_at=CASE WHEN $7 THEN now() ELSE audits.submitted_at END, updated_at=now() RETURNING *`,
      [uid, date, status, JSON.stringify(manual), snapshot && JSON.stringify(snapshot), revision, submit]);
    await query("INSERT INTO audit_revisions(audit_id,revision,status,manual,snapshot) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)", [row.id, row.revision, row.status, JSON.stringify(manual), snapshot && JSON.stringify(snapshot)]);
    if (submit) {
      const admins = await query("SELECT id FROM users WHERE role='superadmin'");
      await notifyMany(admins.map((a) => a.id), "audit_submitted", "Daily audit submitted", `${ctx.user.full_name} · ${date}`, "#/audits");
    }
    return { audit: { id: row.id, status: row.status, revision: row.revision } };
  }
  r.put("/api/me/audits/:date", (ctx) => saveAudit(ctx, false), S);
  r.post("/api/me/audits/:date/submit", (ctx) => saveAudit(ctx, true), S);
  r.get("/api/me/audits/:date/revisions", async (ctx) => {
    const a = await one("SELECT id FROM audits WHERE user_id=$1 AND audit_date=$2", [ctx.user.id, dateStr(ctx.params.date)]);
    if (!a) throw notFound();
    return { revisions: await query("SELECT revision,status,saved_at FROM audit_revisions WHERE audit_id=$1 ORDER BY id DESC LIMIT 100", [a.id]) };
  }, S);

  // ================= NOTIFICATIONS / ANNOUNCEMENTS (any signed-in role) =================
  r.get("/api/notifications", async (ctx) => {
    const p = [ctx.user.id]; let w = "user_id=$1";
    if (ctx.query.unread === "1") w += " AND read_at IS NULL";
    const items = await query(`SELECT * FROM notifications WHERE ${w} ORDER BY id DESC LIMIT 100`, p);
    const [u] = await query("SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND read_at IS NULL", [ctx.user.id]);
    return { notifications: items, unread: u.n };
  });
  r.post("/api/notifications/read", async (ctx) => {
    if (ctx.body.all) await query("UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL", [ctx.user.id]);
    else if (Array.isArray(ctx.body.ids)) await query("UPDATE notifications SET read_at=now() WHERE user_id=$1 AND id = ANY($2::int[])", [ctx.user.id, ctx.body.ids.map(Number).filter(Number.isInteger).slice(0, 200)]);
    return { ok: true };
  });
  r.get("/api/announcements", async (ctx) => ({
    announcements: await query(
      `SELECT a.id,a.title,a.body,a.created_at, u.full_name AS author FROM announcements a JOIN users u ON u.id=a.created_by
       WHERE a.recipients IS NULL OR $1 = ANY(a.recipients) ORDER BY a.id DESC LIMIT 50`, [ctx.user.id]),
  }));

  // ================= EXPORTS =================
  r.get("/api/me/export/:type", async (ctx) => {
    if (!REPORTS_STAFF.includes(ctx.params.type)) throw notFound();
    const { from, to } = range(ctx.query);
    return csvResponse(ctx.params.type, await buildReport(ctx.params.type, { from, to, userId: ctx.user.id }));
  }, S);
}
export { range };
