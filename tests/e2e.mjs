// Browser end-to-end check against `node scripts/dev-server.mjs` (local throwaway DB). Run: node tests/e2e.mjs
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:8899", SHOTS = process.env.SHOTS || "/tmp/shots";
import { mkdirSync } from "node:fs"; mkdirSync(SHOTS, { recursive: true });
const problems = []; let passed = 0;
const check = (cond, msg) => { if (cond) passed++; else { problems.push(msg); console.log("FAIL:", msg); } };
const browser = await chromium.launch();
async function ctx(width = 1280, height = 800) {
  const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 }); const p = await c.newPage();
  p.on("pageerror", (e) => problems.push("pageerror: " + e.message + " @" + p.url()));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push("console: " + m.text() + " @" + p.url()); });
  return { c, p };
}
async function login(p, user, pw, newPw) {
  await p.goto(BASE + (user === "admin" ? "/admin/" : "/")); await p.fill("input[autocomplete=username]", user); await p.fill("input[autocomplete=current-password]", pw); await p.click("button[type=submit]");
  if (newPw) { await p.waitForSelector("text=Set a new password"); const f = await p.$$("form input[type=password]"); await f[f.length - 2].fill(newPw); await f[f.length - 1].fill(newPw); await p.click("text=Save and continue"); }
  await p.waitForURL(/\/(admin|app)\//);
}
const api = (p, method, path, body) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "content-type": "application/json", "x-requested-with": "bg" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json().catch(() => null) }; }, [method, path, body]);

// ---------- admin ----------
let { c: ac, p: admin } = await ctx();
await admin.goto(BASE + "/admin/"); await admin.waitForSelector("text=Administrator sign-in"); check(await admin.isVisible("text=Administrator sign-in"), "admin has its own sign-in page"); check(!(await admin.isVisible("text=Create a staff account")), "admin page has no sign-up");
await admin.fill("input[autocomplete=username]", "admin"); await admin.fill("input[autocomplete=current-password]", "wrong-password"); await admin.click("button[type=submit]");
await admin.waitForSelector(".err:not(:empty)"); check(true, "wrong password shows error");
await login(admin, "admin", "Temp-Pass-1", "Owner-Secure-2026");
check(admin.url().includes("/admin/"), "admin lands on /admin/");
await admin.waitForSelector(".stat"); await admin.screenshot({ path: SHOTS + "/admin-overview.png" });

// create staff through the UI
await admin.goto(BASE + "/admin/#/staff"); await admin.waitForSelector("text=Create staff account");
await admin.click("button:has-text('Create staff account')");
await admin.fill("input[maxlength='120']", "Maria Santos"); await admin.locator(".modal input").nth(1).fill("maria"); await admin.locator(".modal input").nth(2).fill("Social Media Lead");
await admin.click(".modal button:has-text('Create account')");
await admin.waitForSelector("pre.code"); const creds = await admin.textContent("pre.code"); const temp = creds.match(/Temporary password: (\S+)/)[1];
check(!!temp, "temporary password shown once"); await admin.click("button:has-text('Done')");

// ---------- staff ----------
let { c: sc, p: staff } = await ctx();
await login(staff, "maria", temp, "Strong-Staff-2026");
check(staff.url().includes("/app/"), "staff lands on /app/");
await staff.waitForSelector(".stat");
check((await api(staff, "GET", "/api/admin/staff")).status === 403, "staff blocked from admin API");
await staff.goto(BASE + "/admin/"); await staff.waitForSelector("text=Administrator sign-in"); check(!(await staff.isVisible("#view")), "staff session sees only the admin sign-in page at /admin/");
await staff.goto(BASE + "/app/"); await staff.waitForSelector(".stat");
// seed realistic data via the same API the UI uses
const pl = await api(staff, "POST", "/api/me/platforms", { kind: "Facebook", name: "Facebook Page", profile_name: "Maria Studio", profile_url: "https://facebook.com/maria" });
await api(staff, "POST", "/api/me/platforms", { kind: "Instagram", name: "Instagram", profile_name: "@maria" });
await api(staff, "POST", "/api/me/posts", { platform_id: pl.data.id, links: "https://facebook.com/groups/1/posts/1 https://facebook.com/groups/1/posts/2\nhttps://facebook.com/groups/1/posts/3", title: "Spring promo" });
const cl = await api(staff, "POST", "/api/me/clients", { name: "Acme Corp", service: "Website redesign", price: 10000, platform_id: pl.data.id });
const pay = await api(staff, "POST", `/api/me/clients/${cl.data.id}/payments`, { kind: "initial", amount: 5000 });
await api(staff, "POST", "/api/me/tasks", { title: "Follow up with Acme", priority: "high", deadline: new Date(Date.now() + 86400e3).toISOString(), checklist: [{ text: "Send quote" }] });
await api(staff, "POST", "/api/me/notes", { title: "Call notes", body: "Acme wants a new logo", type: "work" });
await api(staff, "POST", "/api/me/notes", { title: "Ideas", body: "Private thoughts", type: "personal" });
await api(admin, "POST", "/api/admin/tasks", { title: "Post in 5 groups", assignees: [2], requires_evidence: true, priority: "urgent" });

const STAFF_ROUTES = ["dashboard", "tasks", "posts", "notes", "clients", "audit", "earnings", "platforms", "notifications", "profile"];
const ADMIN_ROUTES = ["overview", "staff", "audits", "tasks", "posts", "platforms", "clients", "payments", "commissions", "tips", "rankings", "reports", "announcements", "logs", "settings", "backups", "notifications"];
async function visit(p, base, id, label) {
  await p.goto(`${BASE}${base}#/${id}`); await p.waitForSelector("#view .page", { timeout: 8000 }).catch(() => {});
  const failed = await p.$("#view .empty:has-text('Could not load')"); check(!failed, `${label} ${id} loads`);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); check(over <= 1, `${label} ${id} no horizontal overflow (${over}px) at ${p.viewportSize().width}`);
}
for (const id of STAFF_ROUTES) await visit(staff, "/app/", id, "staff");
await staff.goto(BASE + "/app/#/dashboard"); await staff.waitForSelector(".stat"); await staff.waitForTimeout(700); await staff.screenshot({ path: SHOTS + "/staff-dashboard.png" });
await staff.goto(BASE + "/app/#/notes"); await staff.waitForSelector(".nitem"); await staff.click(".nitem >> nth=0"); await staff.waitForTimeout(300); await staff.screenshot({ path: SHOTS + "/staff-notes.png" });
// notes autosave
await staff.fill(".ned .t", "Renamed by test"); await staff.waitForSelector("text=/Saved/", { timeout: 4000 }); check(true, "note autosaves");
await staff.goto(BASE + "/app/#/audit"); await staff.waitForSelector("text=Posting accomplishments"); await staff.screenshot({ path: SHOTS + "/staff-audit.png", fullPage: true });
check((await staff.textContent("#view")).includes("Maria Santos"), "audit prefilled with staff name"); check((await staff.textContent("#view")).includes("facebook.com/groups/1/posts/1"), "audit prefilled with posted links");
await staff.click("button:has-text('Preview')"); await staff.waitForSelector(".modal"); await staff.click(".modal-h .icon-btn");
await staff.click("button:has-text('Submit audit')"); await staff.waitForSelector(".modal button:has-text('Submit audit')"); await staff.click(".modal button:has-text('Submit audit')");
await staff.waitForSelector("text=awaiting administrator review", { timeout: 5000 }); check(true, "audit submit locks audit");
for (const id of ["tasks", "posts"]) { await staff.goto(`${BASE}/app/#/${id}`); await staff.waitForTimeout(600); }
await staff.goto(BASE + "/app/#/tasks"); await staff.waitForSelector(".task"); await staff.click(".task >> nth=0"); await staff.waitForSelector(".modal"); await staff.screenshot({ path: SHOTS + "/staff-task-modal.png" }); await staff.keyboard.press("Escape");
await staff.goto(BASE + "/app/#/earnings"); await staff.waitForSelector(".stat"); await staff.waitForTimeout(700); await staff.screenshot({ path: SHOTS + "/staff-earnings.png", fullPage: true });

// ---------- self sign-up + portal separation ----------
{ const { c, p } = await ctx(); await p.goto(BASE + "/");
  await p.fill("input[autocomplete=username]", "admin"); await p.fill("input[autocomplete=current-password]", "Owner-Secure-2026"); await p.click("button[type=submit]");
  await p.waitForSelector(".err:not(:empty)"); check((await p.textContent(".err")).includes("Invalid"), "admin credentials rejected on the staff page");
  await p.click("text=Create a staff account"); await p.waitForSelector("text=Create your account");
  const ins = await p.$$("form input"); await ins[0].fill("Lena Cruz"); await ins[1].fill("lena"); await ins[2].fill("Sales"); await ins[3].fill("Sturdy-Pass-2026"); await ins[4].fill("Sturdy-Pass-2026");
  await p.click("button:has-text('Create account')"); await p.waitForURL(/\/app\//); await p.waitForSelector(".stat"); check(true, "staff can create their own account and land in /app/");
  check((await p.textContent("#view")).includes("Lena"), "new staff sees their own dashboard"); await c.close(); }
{ const { c, p } = await ctx(); await p.goto(BASE + "/admin/"); await p.fill("input[autocomplete=username]", "maria"); await p.fill("input[autocomplete=current-password]", "Strong-Staff-2026"); await p.click("button[type=submit]");
  await p.waitForSelector(".err:not(:empty)"); check((await p.textContent(".err")).includes("Invalid"), "staff credentials rejected on the admin page"); await c.close(); }
// ---------- admin work ----------
for (const id of ADMIN_ROUTES) await visit(admin, "/admin/", id, "admin");
await admin.goto(BASE + "/admin/#/payments"); await admin.waitForSelector("button:has-text('Verify')"); await admin.screenshot({ path: SHOTS + "/admin-payments.png" });
await admin.click("button:has-text('Verify')"); await admin.waitForSelector(".modal button:has-text('Verify')"); await admin.click(".modal button:has-text('Verify')"); await admin.waitForSelector("text=Payment verified");
check(true, "admin verifies payment via UI");
await admin.goto(BASE + "/admin/#/commissions"); await admin.waitForSelector("text=Awaiting full payment"); check(true, "commission locked after initial payment only");
await admin.goto(BASE + "/admin/#/staff/2"); await admin.waitForSelector("text=Performance trend"); await admin.screenshot({ path: SHOTS + "/admin-staff-profile.png", fullPage: true });
const prof = await admin.textContent("#view"); check(!/password_hash|scrypt/.test(prof), "no password data in staff profile"); check(prof.includes("Acme wants a new logo") && !prof.includes("Private thoughts"), "admin sees only shared work notes");
await admin.goto(BASE + "/admin/#/rankings"); await admin.waitForSelector("text=Staff ranking"); await admin.screenshot({ path: SHOTS + "/admin-rankings.png", fullPage: true });
await admin.goto(BASE + "/admin/#/audits"); await admin.waitForSelector("button:has-text('Review')"); await admin.click("button:has-text('Review')"); await admin.waitForSelector(".modal"); await admin.click(".modal button:has-text('Approve')"); await admin.waitForSelector("text=Audit approved"); check(true, "admin approves audit via UI");
await admin.goto(BASE + "/admin/#/tasks"); await admin.waitForSelector(".tbl"); await admin.screenshot({ path: SHOTS + "/admin-tasks.png" });
// CSV export through the real download path
await admin.goto(BASE + "/admin/#/reports"); await admin.waitForSelector("text=rows"); const [dl] = await Promise.all([admin.waitForEvent("download"), admin.click("button:has-text('Export CSV')")]); check(dl.suggestedFilename().endsWith(".csv"), "CSV export downloads");

// ---------- responsive: staff + admin at phone/tablet widths ----------
for (const w of [320, 390, 768]) {
  const { c, p } = await ctx(w, 800); await login(p, "maria", "Strong-Staff-2026");
  for (const id of STAFF_ROUTES) await visit(p, "/app/", id, "staff");
  if (w === 390) { await p.goto(BASE + "/app/#/dashboard"); await p.waitForSelector(".stat"); await p.waitForTimeout(700); await p.screenshot({ path: SHOTS + "/m390-dashboard.png" }); await p.goto(BASE + "/app/#/notes"); await p.waitForSelector(".nitem"); await p.screenshot({ path: SHOTS + "/m390-notes.png" }); await p.goto(BASE + "/app/#/clients"); await p.waitForSelector(".tbl"); await p.screenshot({ path: SHOTS + "/m390-clients.png" }); }
  check(await p.evaluate(() => getComputedStyle(document.querySelector(".bn")).display !== "none"), `bottom nav visible at ${w}`);
  await c.close();
  const a = await ctx(w, 800); await login(a.p, "admin", "Owner-Secure-2026");
  for (const id of ADMIN_ROUTES) await visit(a.p, "/admin/", id, "admin");
  if (w === 390) { await a.p.goto(BASE + "/admin/#/overview"); await a.p.waitForSelector(".stat"); await a.p.waitForTimeout(700); await a.p.screenshot({ path: SHOTS + "/m390-admin.png" }); }
  await a.c.close();
}
// reduced motion + dark
const dark = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "dark", reducedMotion: "reduce" }); const dp = await dark.newPage(); await login(dp, "maria", "Strong-Staff-2026"); await dp.waitForSelector(".stat"); await dp.screenshot({ path: SHOTS + "/staff-dark.png" });
check(await dp.evaluate(() => document.documentElement.dataset.theme === "dark"), "dark theme follows system");
await browser.close();
console.log(`\n${passed} checks passed, ${problems.length} problem(s)`); problems.forEach((x) => console.log(" -", x)); process.exit(problems.length ? 1 : 0);
