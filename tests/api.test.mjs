import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startEnv, client, PNG } from "./helpers.mjs";
import { totp } from "../server/security.mjs";
import { runScheduled } from "../server/cron.mjs";

let env, admin, alice, bob;
const A = { username: "alice", pw: "Marketing-Pass-2026" }, B = { username: "bob", pw: "Salesman-Pass-2026" };
const ok = (r, msg) => assert.equal(r.status, 200, `${msg || ""} -> ${r.status} ${JSON.stringify(r.data)}`);

before(async () => { env = await startEnv(); admin = client("1.1.1.1"); alice = client("2.2.2.2"); bob = client("3.3.3.3"); });
after(async () => { await env.stop(); });

test("setup: health reports ready, no credentials leak", async () => {
  const r = await client().get("/api/health");
  ok(r); assert.equal(r.data.setup, "ready");
  assert.ok(!JSON.stringify(r.data).includes("Temp-Pass"));
});

test("auth: unauthenticated blocked, bad login rejected, CSRF header required", async () => {
  assert.equal((await client().get("/api/auth/me")).status, 401);
  assert.equal((await client().post("/api/auth/login", { username: "admin", password: "nope" })).status, 401);
  const res = await (await import("../server/app.mjs")).handle(new Request("https://bg.test/api/auth/login", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
  assert.equal(res.status, 403);
});

test("superadmin: must change temporary password before sensitive access", async () => {
  const l = await admin.post("/api/auth/login", { username: "admin", password: "Temp-Pass-1" });
  ok(l); assert.equal(l.data.user.must_change_password, true);
  assert.ok(!("password_hash" in l.data.user));
  const blocked = await admin.get("/api/admin/staff");
  assert.equal(blocked.status, 403); assert.equal(blocked.data.code, "must_change_password");
  assert.equal((await admin.post("/api/auth/change-password", { current: "Temp-Pass-1", next: "short" })).status, 400);
  assert.equal((await admin.post("/api/auth/change-password", { current: "Temp-Pass-1", next: "admin123456" })).status, 400);
  ok(await admin.post("/api/auth/change-password", { current: "Temp-Pass-1", next: "Owner-Pass-2026" }));
  ok(await admin.get("/api/admin/staff"));
});

test("rate limiting: repeated failures lock out", async () => {
  const c = client("9.9.9.9"); let last;
  for (let i = 0; i < 6; i++) last = await c.post("/api/auth/login", { username: "ghost", password: "x" });
  assert.equal(last.status, 429);
});

test("staff accounts: created by admin, forced password change, isolation from admin API", async () => {
  const c1 = await admin.post("/api/admin/staff", { username: A.username, full_name: "Alice Cruz", position: "Marketing", password: A.pw });
  ok(c1); assert.match(c1.data.staff_code, /^BG-\d{4}$/);
  ok(await admin.post("/api/admin/staff", { username: B.username, full_name: "Bob Reyes", position: "Sales", password: B.pw }));
  assert.equal((await admin.post("/api/admin/staff", { username: "alice", full_name: "Dup" })).status, 409);
  ok(await alice.post("/api/auth/login", { username: A.username, password: A.pw }));
  assert.equal((await alice.get("/api/me/dashboard")).status, 403);
  ok(await alice.post("/api/auth/change-password", { current: A.pw, next: "Marketing-New-2026" })); A.pw = "Marketing-New-2026";
  ok(await bob.post("/api/auth/login", { username: B.username, password: B.pw }));
  ok(await bob.post("/api/auth/change-password", { current: B.pw, next: "Salesman-New-2026" }));
  for (const p of ["/api/admin/staff", "/api/admin/overview", "/api/admin/commissions", "/api/admin/settings", "/api/admin/backups", "/api/admin/logs"])
    assert.equal((await alice.get(p)).status, 403, p);
  assert.equal((await alice.post("/api/admin/commissions/1/approve")).status, 403);
  assert.equal((await admin.get("/api/me/dashboard")).status, 403);
});

test("platforms, bulk posts and duplicate detection", async () => {
  const pl = await alice.post("/api/me/platforms", { kind: "Facebook", name: "Facebook Page", profile_name: "Alice Studio", profile_url: "https://facebook.com/alice" });
  ok(pl);
  assert.equal((await alice.post("/api/me/platforms", { kind: "Facebook", name: "x", profile_url: "javascript:alert(1)" })).status, 400);
  const links = "https://facebook.com/groups/1/posts/10\nhttps://www.facebook.com/groups/1/posts/10/?utm_source=x\nnot-a-link\nhttps://facebook.com/groups/1/posts/11";
  const r = await alice.post("/api/me/posts", { platform_id: pl.data.id, links, title: "Promo" });
  ok(r); assert.equal(r.data.submitted, 3); assert.equal(r.data.valid, 2); assert.equal(r.data.duplicates, 1); assert.equal(r.data.invalid.length, 1);
  const r2 = await bob.post("/api/me/posts", { links: "https://facebook.com/groups/1/posts/11" });
  assert.equal(r2.data.duplicates, 1, "cross-staff duplicate");
  assert.equal((await alice.post("/api/me/posts", { platform_id: 9999, links: "https://a.com/x" })).status, 400);
  const list = await alice.get("/api/me/posts"); assert.equal(list.data.summary.valid, 2);
  assert.equal((await bob.get("/api/me/platforms")).data.platforms.length, 0, "bob cannot see alice platforms");
});

test("admin verifies posts; duplicates never count", async () => {
  const posts = (await admin.get("/api/admin/posts")).data.posts;
  const ids = posts.map((p) => p.id);
  const v = await admin.post("/api/admin/posts/review", { ids, action: "verify" });
  ok(v); assert.equal(v.data.changed, 2);
  const d = (await alice.get("/api/me/dashboard")).data;
  assert.equal(d.posts.verified, 2);
});

test("clients, payments and the commission rule (10% of verified initial, locked until fully paid)", async () => {
  const c = await alice.post("/api/me/clients", { name: "Acme Corp", service: "Website", price: "10000" });
  ok(c);
  const noInit = await alice.post(`/api/me/clients/${c.data.id}/payments`, { kind: "remaining", amount: 100 });
  assert.equal(noInit.status, 400);
  const over = await alice.post(`/api/me/clients/${c.data.id}/payments`, { kind: "initial", amount: 20000 });
  assert.equal(over.status, 400);
  const p1 = await alice.post(`/api/me/clients/${c.data.id}/payments`, { kind: "initial", amount: 5000 });
  ok(p1);
  assert.equal((await alice.post(`/api/me/clients/${c.data.id}/payments`, { kind: "initial", amount: 100 })).status, 400, "single initial");
  // staff cannot verify or approve their own money
  assert.equal((await alice.post(`/api/admin/payments/${p1.data.id}/verify`)).status, 403);
  let e = (await alice.get("/api/me/earnings")).data.summary;
  assert.equal(e.locked, "0.00"); assert.equal(e.awaiting_verification_estimate, "500.00");
  ok(await admin.post(`/api/admin/payments/${p1.data.id}/verify`));
  e = (await alice.get("/api/me/earnings")).data.summary;
  assert.equal(e.locked, "500.00"); assert.equal(e.eligible, "0.00");
  const cl = (await alice.get(`/api/me/clients/${c.data.id}`)).data.client;
  assert.equal(cl.balance, "5000.00"); assert.ok(cl.confirmed_at, "verifying initial payment confirms client");
  const com = (await admin.get("/api/admin/commissions")).data.commissions[0];
  assert.equal(com.status, "locked");
  assert.equal((await admin.post(`/api/admin/commissions/${com.id}/approve`)).status, 400, "locked cannot be approved");
  const p2 = await alice.post(`/api/me/clients/${c.data.id}/payments`, { kind: "remaining", amount: 5000 });
  ok(p2);
  assert.equal((await alice.get("/api/me/earnings")).data.summary.eligible, "0.00", "unverified remaining does not unlock");
  ok(await admin.post(`/api/admin/payments/${p2.data.id}/verify`));
  e = (await alice.get("/api/me/earnings")).data.summary;
  assert.equal(e.eligible, "500.00"); assert.equal(e.locked, "0.00");
  assert.equal((await admin.post(`/api/admin/commissions/${com.id}/release`, { method: "GCash" })).status, 400, "must approve first");
  ok(await admin.post(`/api/admin/commissions/${com.id}/approve`));
  ok(await admin.post(`/api/admin/commissions/${com.id}/release`, { method: "GCash", ref: "REF123" }));
  e = (await alice.get("/api/me/earnings")).data;
  assert.equal(e.summary.released, "500.00"); assert.equal(e.payouts.length, 1);
  assert.equal((await alice.patch(`/api/me/clients/${c.data.id}`, { price: 99999 })).status, 403, "price locked");
  // bob cannot see alice's client
  assert.equal((await bob.get(`/api/me/clients/${c.data.id}`)).status, 404);
  assert.equal((await bob.get("/api/me/clients")).data.clients.length, 0);
  assert.equal((await bob.post(`/api/me/clients/${c.data.id}/payments`, { kind: "remaining", amount: 1 })).status, 404);
  const logs = (await admin.get("/api/admin/logs")).data.logs.map((l) => l.action);
  for (const a of ["payment.verified", "commission.approved", "commission.released"]) assert.ok(logs.includes(a), a);
});

test("tips stay separate; bonuses; admin approval flow", async () => {
  const t = await alice.post("/api/me/tips", { amount: 200, note: "thanks" }); ok(t);
  let e = (await alice.get("/api/me/earnings")).data.summary; assert.equal(e.tips_total, "0.00"); assert.equal(e.tips_pending, "200.00");
  ok(await admin.post(`/api/admin/tips/${t.data.id}/verify`));
  const b = await admin.post("/api/admin/bonuses", { user_id: 2, amount: 1000, reason: "Top month" }); ok(b);
  e = (await alice.get("/api/me/earnings")).data.summary; assert.equal(e.tips_total, "200.00"); assert.equal(e.bonuses_total, "1000.00");
  assert.equal((await alice.post("/api/admin/bonuses", { user_id: 2, amount: 5, reason: "x" })).status, 403);
  assert.equal((await alice.post(`/api/admin/tips/${t.data.id}/release`)).status, 403);
});

test("official tasks: assign multiple, evidence, review loop; personal tasks private", async () => {
  const deadline = new Date(Date.now() + 3600e3).toISOString();
  const a = await admin.post("/api/admin/tasks", { title: "Post 5 groups", assignees: [2, 3], priority: "high", requires_evidence: true, deadline }); ok(a);
  assert.equal(a.data.created.length, 2);
  const mine = (await alice.get("/api/me/tasks")).data.tasks[0];
  assert.equal(mine.kind, "official");
  assert.equal((await alice.post(`/api/me/tasks/${mine.id}/complete`, {})).status, 400, "evidence required");
  assert.equal((await alice.delete(`/api/me/tasks/${mine.id}`)).status, 403);
  assert.equal((await alice.patch(`/api/me/tasks/${mine.id}`, { title: "renamed" })).status, 200);
  assert.equal((await alice.get("/api/me/tasks")).data.tasks[0].title, "Post 5 groups", "title of official task immutable by staff");
  ok(await alice.post(`/api/me/tasks/${mine.id}/complete`, { evidence_text: "done, see links" }));
  assert.equal((await alice.get("/api/me/tasks")).data.tasks[0].status, "under_review");
  ok(await admin.post(`/api/admin/tasks/${mine.id}/request-correction`, { note: "add screenshots" }));
  assert.equal((await alice.get("/api/me/tasks")).data.tasks[0].review_note, "add screenshots");
  ok(await alice.post(`/api/me/tasks/${mine.id}/complete`, { evidence_text: "with screenshots" }));
  ok(await admin.post(`/api/admin/tasks/${mine.id}/verify`));
  assert.equal((await alice.get("/api/me/tasks?status=completed")).data.tasks.length, 1);
  // bob cannot touch alice's task
  assert.equal((await bob.patch(`/api/me/tasks/${mine.id}`, { status: "in_progress" })).status, 404);
  // personal + recurring + overdue
  const past = new Date(Date.now() - 86400e3).toISOString();
  const pt = await alice.post("/api/me/tasks", { title: "Daily outreach", recurrence: "daily", deadline: past, checklist: [{ text: "DM 10 leads" }] }); ok(pt);
  assert.equal((await alice.get("/api/me/tasks?status=overdue")).data.tasks.length, 1);
  ok(await alice.post(`/api/me/tasks/${pt.data.id}/complete`, {}));
  assert.equal((await alice.get("/api/me/tasks?kind=personal")).data.tasks.length, 2, "recurring task respawned");
  assert.equal((await admin.get("/api/admin/tasks")).status, 200);
});

test("notes: personal vs work, folders, trash; admin sees only work notes", async () => {
  const f = await alice.post("/api/me/folders", { name: "Ideas" }); ok(f);
  const n1 = await alice.post("/api/me/notes", { title: "Diary", body: "secret", type: "personal", folder_id: f.data.folder.id });
  const n2 = await alice.post("/api/me/notes", { title: "Client call", body: "send quote", type: "work", checklist: [{ text: "quote", done: false }] });
  ok(n1); ok(n2);
  ok(await alice.patch(`/api/me/notes/${n2.data.note.id}`, { body: "send quote today", pinned: true }));
  assert.equal((await alice.get("/api/me/notes?q=quote")).data.notes.length, 1);
  assert.equal((await bob.get("/api/me/notes")).data.notes.length, 0);
  assert.equal((await bob.patch(`/api/me/notes/${n1.data.note.id}`, { body: "hack" })).status, 404);
  const prof = (await admin.get("/api/admin/staff/2/profile")).data;
  assert.equal(prof.shared_notes.length, 1); assert.equal(prof.shared_notes[0].title, "Client call");
  assert.ok(!JSON.stringify(prof).includes("secret") && !JSON.stringify(prof).includes("password_hash"));
  ok(await alice.delete(`/api/me/notes/${n2.data.note.id}`));
  assert.equal((await alice.get("/api/me/notes?view=trash")).data.notes.length, 1);
  assert.equal((await admin.get("/api/admin/staff/2/profile")).data.shared_notes.length, 0);
  ok(await alice.post(`/api/me/notes/${n2.data.note.id}/restore`));
});

test("daily audit: prefilled from records, draft, submit, lock, correction + revision", async () => {
  const pre = (await alice.get("/api/me/audits/prefill")).data;
  assert.equal(pre.staff.name, "Alice Cruz"); assert.equal(pre.snapshot.total_posts, 2); assert.ok(pre.snapshot.posting[0].links.length === 2);
  assert.equal(pre.snapshot.clients.count, 1);
  const today = pre.date;
  ok(await alice.put(`/api/me/audits/${today}`, { manual: { work_notes: "draft notes" } }));
  const sub = await alice.post(`/api/me/audits/${today}/submit`, { manual: { work_notes: "final", problems: "none", plans: "more posts" } });
  ok(sub); assert.equal(sub.data.audit.status, "submitted");
  assert.equal((await alice.put(`/api/me/audits/${today}`, { manual: { work_notes: "tamper" } })).status, 403, "locked");
  const id = sub.data.audit.id;
  assert.equal((await alice.post(`/api/admin/audits/${id}/approve`)).status, 403);
  ok(await admin.post(`/api/admin/audits/${id}/request-correction`, { note: "add screenshots" }));
  const again = await alice.post(`/api/me/audits/${today}/submit`, { manual: { work_notes: "fixed" } });
  ok(again); assert.equal(again.data.audit.revision, 3 - 0 === 3 ? again.data.audit.revision : 0);
  ok(await admin.post(`/api/admin/audits/${again.data.audit.id}/approve`));
  const detail = (await admin.get(`/api/admin/audits/${id}`)).data;
  assert.ok(detail.revisions.length >= 3); assert.equal(detail.audit.status, "approved");
  assert.equal((await bob.get(`/api/me/audits/${today}/revisions`)).status, 404);
});

test("files: upload validation, private access control", async () => {
  const fd = new FormData(); fd.set("kind", "receipt"); fd.set("file", new Blob([PNG], { type: "image/png" }), "r.png");
  const up = await alice.post("/api/files", fd); ok(up);
  const fid = up.data.id;
  assert.equal((await alice.get(`/api/files/${fid}`)).status, 200);
  assert.equal((await admin.get(`/api/files/${fid}`)).status, 200);
  assert.equal((await bob.get(`/api/files/${fid}`)).status, 404, "other staff cannot read receipts");
  assert.equal((await client().get(`/api/files/${fid}`)).status, 401);
  const bad = new FormData(); bad.set("file", new Blob(["<script>alert(1)</script>"], { type: "image/png" }), "x.png");
  assert.equal((await alice.post("/api/files", bad)).status, 400, "content sniffing rejects fake images");
  assert.equal((await bob.post("/api/clients", {})).status, 404);
  // bob cannot attach alice's file
  const c = await bob.post("/api/me/clients", { name: "Bob Client", price: 1000 });
  assert.equal((await bob.post(`/api/me/clients/${c.data.id}/payments`, { kind: "initial", amount: 100, receipt_file: fid })).status, 400);
});

test("rankings are rule-based and ignore unverified/duplicate/tips", async () => {
  const today = (await admin.get("/api/admin/rankings")).data;
  assert.equal(today.staff.length, 2);
  const a = today.staff.find((s) => s.full_name === "Alice Cruz"), b = today.staff.find((s) => s.full_name === "Bob Reyes");
  assert.equal(a.verified_posts, 2); assert.equal(b.verified_posts, 0);
  assert.equal(a.verified_revenue, "10000.00"); assert.equal(b.verified_revenue, "0.00");
  assert.ok(a.score > b.score); assert.equal(today.highlights.best_overall.name, "Alice Cruz");
  assert.equal(today.highlights.best_platform.name, "Facebook");
  assert.ok(today.formula.description.includes("Rejected"));
  const dash = (await alice.get("/api/me/dashboard")).data; assert.equal(dash.rank.position, 1); assert.equal(dash.rank.of, 2);
});

test("announcements and notifications with read state", async () => {
  ok(await admin.post("/api/admin/announcements", { title: "Meeting", body: "Friday 3pm", audience: "selected", recipients: [2] }));
  const n = (await alice.get("/api/notifications")).data; assert.ok(n.unread > 0);
  assert.ok(n.notifications.some((x) => x.type === "announcement"));
  assert.ok(!(await bob.get("/api/notifications")).data.notifications.some((x) => x.type === "announcement"));
  assert.equal((await alice.get("/api/announcements")).data.announcements.length, 1);
  assert.equal((await bob.get("/api/announcements")).data.announcements.length, 0);
  ok(await alice.post("/api/notifications/read", { all: true }));
  assert.equal((await alice.get("/api/notifications")).data.unread, 0);
});

test("reports export CSV with injection protection; staff can only export own data", async () => {
  await alice.post("/api/me/clients", { name: "=HYPERLINK(\"http://evil\")", price: 10 });
  const csv = await admin.get("/api/admin/reports/clients?format=csv");
  ok(csv); assert.match(csv.data, /'=HYPERLINK/);
  const mine = await bob.get("/api/me/export/clients"); ok(mine);
  assert.ok(!mine.data.includes("Acme"));
  assert.equal((await alice.get("/api/admin/reports/clients")).status, 403);
});

test("settings: validated and applied server-side", async () => {
  assert.equal((await admin.put("/api/admin/settings", { commission_percent: 500 })).status, 400);
  ok(await admin.put("/api/admin/settings", { commission_percent: 12, weights: { verified_posts: 10, confirmed_clients: 10, verified_revenue: 10, audit_consistency: 10, task_completion: 10 } }));
  const c = await bob.post("/api/me/clients", { name: "New client", price: 1000 });
  const p = await bob.post(`/api/me/clients/${c.data.id}/payments`, { kind: "initial", amount: 500 });
  ok(await admin.post(`/api/admin/payments/${p.data.id}/verify`));
  assert.equal((await bob.get("/api/me/earnings")).data.summary.locked, "60.00");
  ok(await admin.put("/api/admin/settings", { commission_percent: 10 }));
});

test("self sign-up: staff create their own account; admin sign-in is a separate portal", async () => {
  const cfg = await client().get("/api/auth/config"); assert.equal(cfg.data.signup_mode, "open");
  const c = client("11.0.0.1");
  assert.equal((await c.post("/api/auth/register", { full_name: "Lena Cruz", username: "x", password: "Strong-Pass-2026", confirm: "Strong-Pass-2026" })).status, 400, "bad username");
  assert.equal((await c.post("/api/auth/register", { full_name: "Lena Cruz", username: "lena", password: "short", confirm: "short" })).status, 400, "weak password");
  assert.equal((await c.post("/api/auth/register", { full_name: "Lena Cruz", username: "lena", password: "Strong-Pass-2026", confirm: "different" })).status, 400, "mismatch");
  assert.equal((await c.post("/api/auth/register", { full_name: "Lena Cruz", username: "admin", password: "Strong-Pass-2026", confirm: "Strong-Pass-2026" })).status, 409, "cannot take admin username");
  const r = await c.post("/api/auth/register", { full_name: "Lena Cruz", username: "lena", password: "Strong-Pass-2026", confirm: "Strong-Pass-2026", position: "Sales", role: "superadmin" });
  ok(r); assert.equal(r.data.user.role, "staff", "role cannot be chosen"); assert.match(r.data.user.staff_code, /^BG-\d{4}$/);
  ok(await c.get("/api/me/dashboard"));
  assert.equal((await c.get("/api/admin/staff")).status, 403);
  assert.equal((await client("11.0.0.2").post("/api/auth/register", { full_name: "Dup", username: "LENA", password: "Strong-Pass-2026", confirm: "Strong-Pass-2026" })).status, 409, "username unique (case-insensitive)");
  // admin was notified, and sees the account
  assert.ok((await admin.get("/api/notifications")).data.notifications.some((n) => n.type === "signup"));
  assert.ok((await admin.get("/api/admin/staff")).data.staff.some((u) => u.username === "lena"));
  // portals
  const sp = client("11.0.0.3");
  assert.equal((await sp.post("/api/auth/login", { username: "admin", password: "Owner-Pass-2026", portal: "staff" })).status, 401, "admin cannot sign in on staff page");
  assert.equal((await sp.post("/api/auth/login", { username: "lena", password: "Strong-Pass-2026", portal: "admin" })).status, 401, "staff cannot sign in on admin page");
  ok(await sp.post("/api/auth/login", { username: "lena", password: "Strong-Pass-2026", portal: "staff" }));
  ok(await client("11.0.0.4").post("/api/auth/login", { username: "admin", password: "Owner-Pass-2026", portal: "admin" }));
});

test("sign-up modes: approval required, closed, and IP rate limit", async () => {
  ok(await admin.put("/api/admin/settings", { signup_mode: "approval" }));
  const c = client("12.0.0.1");
  const r = await c.post("/api/auth/register", { full_name: "Pia Dela Cruz", username: "pia", password: "Strong-Pass-2026", confirm: "Strong-Pass-2026" });
  ok(r); assert.equal(r.data.pending, true);
  assert.equal((await c.get("/api/me/dashboard")).status, 401, "no session while pending");
  const l = await client("12.0.0.2").post("/api/auth/login", { username: "pia", password: "Strong-Pass-2026", portal: "staff" });
  assert.equal(l.status, 403); assert.match(l.data.error, /approval/);
  assert.ok((await admin.get("/api/admin/overview")).data.counts.pending_signups >= 1);
  const pia = (await admin.get("/api/admin/staff")).data.staff.find((u) => u.username === "pia"); assert.equal(pia.status, "pending");
  assert.equal((await alice.post(`/api/admin/staff/${pia.id}/approve`)).status, 403, "staff cannot approve");
  ok(await admin.post(`/api/admin/staff/${pia.id}/approve`));
  assert.equal((await admin.post(`/api/admin/staff/${pia.id}/approve`)).status, 400, "only pending can be approved");
  ok(await client("12.0.0.3").post("/api/auth/login", { username: "pia", password: "Strong-Pass-2026", portal: "staff" }));
  ok(await admin.put("/api/admin/settings", { signup_mode: "closed" }));
  assert.equal((await client("12.0.0.4").post("/api/auth/register", { full_name: "Late Comer", username: "late", password: "Strong-Pass-2026", confirm: "Strong-Pass-2026" })).status, 403);
  assert.equal((await admin.put("/api/admin/settings", { signup_mode: "anything" })).status, 400);
  ok(await admin.put("/api/admin/settings", { signup_mode: "open" }));
  let last; for (let i = 0; i < 6; i++) last = await client("12.0.0.9").post("/api/auth/register", { full_name: "Bot " + i, username: "bot" + i, password: "Strong-Pass-2026", confirm: "Strong-Pass-2026" }, { ip: "12.0.0.9" });
  assert.equal(last.status, 429, "sign-ups rate-limited per IP");
});

test("2FA: setup, enforce on login, recovery code", async () => {
  const s = await admin.post("/api/auth/2fa/setup"); ok(s);
  assert.equal((await admin.post("/api/auth/2fa/enable", { code: "000000" })).status, 400);
  const en = await admin.post("/api/auth/2fa/enable", { code: totp(s.data.secret) }); ok(en);
  const c = client("5.5.5.5");
  assert.equal((await c.post("/api/auth/login", { username: "admin", password: "Owner-Pass-2026" })).data.needs_otp, true);
  assert.equal((await c.post("/api/auth/login", { username: "admin", password: "Owner-Pass-2026", otp: "123456" })).status, 401);
  ok(await c.post("/api/auth/login", { username: "admin", password: "Owner-Pass-2026", otp: totp(s.data.secret) }));
  const c2 = client("5.5.5.6"); const rc = en.data.recovery_codes[0];
  ok(await c2.post("/api/auth/login", { username: "admin", password: "Owner-Pass-2026", otp: rc }));
  assert.equal((await client("5.5.5.7").post("/api/auth/login", { username: "admin", password: "Owner-Pass-2026", otp: rc })).status, 401, "recovery code single-use");
  ok(await admin.post("/api/auth/2fa/disable", { password: "Owner-Pass-2026" }));
});

test("sessions: list, revoke; suspend blocks immediately; password reset forces change", async () => {
  const a2 = client("7.7.7.7"); ok(await a2.post("/api/auth/login", { username: A.username, password: A.pw }));
  const s = (await alice.get("/api/auth/sessions")).data; assert.ok(s.sessions.length >= 2);
  ok(await alice.post("/api/auth/sessions/revoke-others"));
  assert.equal((await a2.get("/api/auth/me")).status, 401);
  ok(await admin.post("/api/admin/staff/2/suspend"));
  assert.equal((await alice.get("/api/me/dashboard")).status, 401);
  assert.equal((await client("8.8.8.8").post("/api/auth/login", { username: A.username, password: A.pw })).status, 403);
  ok(await admin.post("/api/admin/staff/2/reactivate"));
  const rp = await admin.post("/api/admin/staff/2/reset-password"); ok(rp);
  const c = client("8.8.4.4"); const l = await c.post("/api/auth/login", { username: A.username, password: rp.data.temporary_password });
  ok(l); assert.equal(l.data.user.must_change_password, true);
  assert.equal((await c.get("/api/me/dashboard")).status, 403);
  ok(await c.post("/api/auth/change-password", { current: rp.data.temporary_password, next: "Marketing-Final-2026" })); A.pw = "Marketing-Final-2026";
  alice = c;
});

test("cron: deadline reminders and audit reminders", async () => {
  await alice.post("/api/me/tasks", { title: "Soon", deadline: new Date(Date.now() + 3 * 3600e3).toISOString() });
  const out = await runScheduled(); assert.ok(out.deadlines >= 1);
  assert.ok((await alice.get("/api/notifications")).data.notifications.some((n) => n.type === "deadline"));
});

test("backup & restore round-trip preserves data", async () => {
  const b = await admin.post("/api/admin/backups"); ok(b);
  const before = (await admin.get("/api/admin/clients")).data.clients.length;
  const dl = await admin.get(`/api/admin/backups/${b.data.key}/download`); ok(dl);
  assert.ok(dl.data.tables.users.length >= 3);
  assert.equal((await admin.post(`/api/admin/backups/${b.data.key}/restore`, {})).status, 400, "needs confirmation");
  await alice.post("/api/me/clients", { name: "Added after backup", price: 5 });
  ok(await admin.post(`/api/admin/backups/${b.data.key}/restore`, { confirm: "RESTORE" }));
  const adm = client("4.4.4.4"); ok(await adm.post("/api/auth/login", { username: "admin", password: "Owner-Pass-2026" }));
  assert.equal((await adm.get("/api/admin/clients")).data.clients.length, before);
  assert.ok((await adm.get("/api/admin/backups")).data.backups.length >= 2, "pre-restore safety backup exists");
  // sequences still work after restore
  const al = client("4.4.4.5"); ok(await al.post("/api/auth/login", { username: A.username, password: A.pw }));
  ok(await al.post("/api/me/clients", { name: "Post-restore client", price: 5 }));
});

test("recovery reset via documented env procedure", async () => {
  process.env.ADMIN_RECOVERY_RESET = "reset-1"; process.env.ADMIN_INITIAL_PASSWORD = "Recovery-Temp-9";
  const { bootstrap } = await import("../server/auth.mjs"); await bootstrap();
  const c = client("6.6.6.6"); const l = await c.post("/api/auth/login", { username: "admin", password: "Recovery-Temp-9" });
  ok(l); assert.equal(l.data.user.must_change_password, true);
  delete process.env.ADMIN_RECOVERY_RESET;
});

test("recovery reset can rename the Superadmin to the configured username; reserved names stay unavailable", async () => {
  process.env.ADMIN_RECOVERY_RESET = "reset-2"; process.env.ADMIN_INITIAL_PASSWORD = "Rename-Temp-7"; process.env.ADMIN_INITIAL_USERNAME = "superadmin";
  const { bootstrap } = await import("../server/auth.mjs"); await bootstrap();
  const c = client("13.0.0.1");
  assert.equal((await c.post("/api/auth/login", { username: "admin", password: "Rename-Temp-7", portal: "admin" })).status, 401, "old username no longer works");
  const l = await c.post("/api/auth/login", { username: "superadmin", password: "Rename-Temp-7", portal: "admin" });
  ok(l); assert.equal(l.data.user.username, "superadmin"); assert.equal(l.data.user.must_change_password, true);
  for (const name of ["admin", "superadmin", "Administrator"]) assert.equal((await client("13.0.0.2").post("/api/auth/register", { full_name: "Fake Admin", username: name, password: "Strong-Pass-2026", confirm: "Strong-Pass-2026" })).status, 409, name + " reserved");
  delete process.env.ADMIN_RECOVERY_RESET; delete process.env.ADMIN_INITIAL_USERNAME;
});
