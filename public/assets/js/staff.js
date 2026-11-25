import { h, clear, GET, POST, PATCH, PUT, DEL, icon, toast, fail, modal, confirmDialog, formModal, table, empty, stat, chip, label, money, fdate, fdt, ftime, ago, phToday, addDays, startApp, pageHead, rangeBar, seg, avatar, collapsible, detailRows, upload, fileLink, textareaLines, toLocalInput, fromLocalInput, download, barChart } from "./core.js";
import { notesView, auditView, earningsView, notificationsView, profileView } from "./staff2.js";

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "home", key: "d" }, { id: "tasks", label: "Tasks", icon: "tasks", key: "t" },
  { id: "posts", label: "Add Post", short: "Post", icon: "plus", key: "p" }, { id: "notes", label: "Notes", icon: "notes", key: "n" },
  { id: "clients", label: "Clients", icon: "users", key: "c" }, { id: "audit", label: "Daily Audit", icon: "clip", key: "a" },
  { id: "earnings", label: "Earnings", icon: "money", key: "e" }, { id: "platforms", label: "Platforms", icon: "globe", key: "l" },
  { id: "notifications", label: "Notifications", icon: "bell", key: "o" }, { id: "profile", label: "Profile", icon: "user", key: "u" },
];
const PRIORITY = ["low", "normal", "high", "urgent"];
const opts = (arr) => arr.map((v) => ({ value: v, label: label(v) }));

// ================= shared modal flows =================
export async function platformOptions(blank = "No platform") {
  const { platforms } = await GET("/api/me/platforms");
  return [{ value: "", label: blank }, ...platforms.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name + (p.profile_name ? " · " + p.profile_name : "") }))];
}
export async function addPostFlow(onDone) {
  const po = await platformOptions("Choose platform");
  if (po.length === 1) { toast("Add a platform first (Platforms page)", true); location.hash = "#/platforms"; return; }
  await formModal({ title: "Add post", submitText: "Submit post", wide: false,
    fields: [{ name: "platform_id", label: "Platform", type: "select", options: po, required: true }, { name: "links", label: "Post link(s)", type: "textarea", rows: 4, required: true, help: "Paste one or many links, separated by spaces or new lines." },
      { name: "title", label: "Title or description", max: 300 }, { name: "campaign", label: "Campaign (optional)", max: 120 }, { name: "posted_on", label: "Posting date", type: "date", value: phToday() }, { name: "screenshot", label: "Screenshot (optional)", type: "file", accept: "image/*" }],
    onSubmit: async (v) => { const r = await POST("/api/me/posts", { platform_id: v.platform_id, links: v.links, title: v.title, campaign: v.campaign, posted_on: v.posted_on, screenshot_file: await upload(v.screenshot, "screenshot") }); toast(`${r.valid} valid link${r.valid === 1 ? "" : "s"} added${r.duplicates ? `, ${r.duplicates} duplicate` : ""}${r.invalid.length ? `, ${r.invalid.length} invalid` : ""}`); onDone?.(); } });
}
export async function clientForm(existing, onDone) {
  const po = await platformOptions("Not specified");
  await formModal({ title: existing ? "Edit client" : "Add client", submitText: existing ? "Save" : "Add client",
    fields: [{ name: "name", label: "Client name", required: true, value: existing?.name, max: 150 }, { name: "contact", label: "Contact (phone / email / handle)", value: existing?.contact, max: 200 },
      { name: "service", label: "Service requested", value: existing?.service, max: 300 }, { name: "price", label: "Project price (₱)", type: "number", step: "0.01", min: "0", value: existing?.price, inputmode: "decimal", help: existing ? "Locked once payments are recorded." : "" },
      { name: "platform_id", label: "Acquired via", type: "select", options: po, value: existing?.platform_id ?? "" }, { name: "notes", label: "Notes", type: "textarea", value: existing?.notes, max: 4000 }],
    onSubmit: async (v) => { const body = { name: v.name, contact: v.contact, service: v.service, notes: v.notes, platform_id: v.platform_id || null }; if (v.price !== "" && (!existing || Number(v.price) !== Number(existing.price))) body.price = v.price;
      existing ? await PATCH("/api/me/clients/" + existing.id, body) : await POST("/api/me/clients", body); toast(existing ? "Client updated" : "Client added"); onDone?.(); } });
}
export async function paymentForm(client, kind, onDone) {
  await formModal({ title: kind === "initial" ? "Record initial payment" : "Record remaining payment", intro: `${client.name} · Price ${money(client.price)} · Balance ${money(client.balance)}. Payments are reviewed by the administrator before they count.`,
    fields: [{ name: "amount", label: "Amount (₱)", type: "number", step: "0.01", min: "0", required: true, inputmode: "decimal", value: kind === "remaining" ? client.balance : "" }, { name: "paid_on", label: "Date received", type: "date", value: phToday() },
      { name: "receipt", label: "Receipt / proof of payment", type: "file", accept: "image/*,application/pdf" }, { name: "note", label: "Note", max: 500 }],
    onSubmit: async (v) => { await POST(`/api/me/clients/${client.id}/payments`, { kind, amount: v.amount, paid_on: v.paid_on, note: v.note, receipt_file: await upload(v.receipt, "receipt") }); toast("Payment submitted for verification"); onDone?.(); } });
}
export async function tipForm(clientId, onDone) {
  const { clients } = await GET("/api/me/clients");
  await formModal({ title: "Record a tip", intro: "Tips are kept separate from project payments and are not part of commissions.",
    fields: [{ name: "amount", label: "Tip amount (₱)", type: "number", step: "0.01", min: "0", required: true, inputmode: "decimal" }, { name: "client_id", label: "Client", type: "select", value: clientId ?? "", options: [{ value: "", label: "Not linked" }, ...clients.map((c) => ({ value: c.id, label: c.name }))] },
      { name: "received_on", label: "Date", type: "date", value: phToday() }, { name: "note", label: "Note", max: 300 }, { name: "receipt", label: "Proof (optional)", type: "file", accept: "image/*,application/pdf" }],
    onSubmit: async (v) => { await POST("/api/me/tips", { amount: v.amount, client_id: v.client_id || null, received_on: v.received_on, note: v.note, receipt_file: await upload(v.receipt, "receipt") }); toast("Tip recorded — awaiting verification"); onDone?.(); } });
}
export async function taskForm(existing, onDone, parent) {
  const [po, cl] = await Promise.all([platformOptions("None"), GET("/api/me/clients")]);
  await formModal({ title: existing ? "Edit task" : parent ? "Add subtask" : "New task",
    fields: [{ name: "title", label: "Title", required: true, value: existing?.title, max: 200 }, { name: "description", label: "Description", type: "textarea", value: existing?.description },
      { name: "deadline", label: "Deadline", type: "datetime-local", value: toLocalInput(existing?.deadline) }, { name: "priority", label: "Priority", type: "select", options: opts(PRIORITY), value: existing?.priority || "normal" },
      { name: "category", label: "Category", value: existing?.category, max: 60, placeholder: "e.g. Posting, Follow-up" }, { name: "recurrence", label: "Repeat", type: "select", options: [{ value: "none", label: "Does not repeat" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }], value: existing?.recurrence || "none" },
      { name: "client_id", label: "Related client", type: "select", value: existing?.client_id ?? "", options: [{ value: "", label: "None" }, ...cl.clients.map((c) => ({ value: c.id, label: c.name }))] }, { name: "platform_id", label: "Related platform", type: "select", options: po, value: existing?.platform_id ?? "" },
      { name: "checklist", label: "Checklist (one item per line)", type: "textarea", value: (existing?.checklist || []).map((i) => i.text).join("\n") }, { name: "requires_evidence", label: "Require evidence to complete", type: "checkbox", value: existing?.requires_evidence }],
    onSubmit: async (v) => { const done = new Set((existing?.checklist || []).filter((i) => i.done).map((i) => i.text));
      const body = { title: v.title, description: v.description, deadline: v.deadline, priority: v.priority, category: v.category, recurrence: v.recurrence, client_id: v.client_id || null, platform_id: v.platform_id || null, requires_evidence: v.requires_evidence, checklist: textareaLines(v.checklist).map((i) => ({ ...i, done: done.has(i.text) })) };
      existing ? await PATCH("/api/me/tasks/" + existing.id, body) : await POST("/api/me/tasks", { ...body, parent_id: parent?.id }); toast("Task saved"); onDone?.(); } });
}
export async function completeFlow(t, onDone) {
  const needs = t.requires_evidence, official = t.kind === "official";
  if (!needs && !official) { await POST(`/api/me/tasks/${t.id}/complete`, {}); toast("Task completed"); onDone?.(); return; }
  await formModal({ title: official ? "Submit for review" : "Complete task", submitText: official ? "Submit for review" : "Mark complete", intro: needs ? "Supporting evidence is required." : "Add any supporting notes or proof (optional).",
    fields: [{ name: "evidence_text", label: "Completion notes / links", type: "textarea", value: t.evidence_text, required: needs && !t.evidence_file }, { name: "file", label: "Screenshot or file", type: "file", accept: "image/*,application/pdf" }],
    onSubmit: async (v) => { const body = { evidence_text: v.evidence_text }; if (v.file) body.evidence_file = await upload(v.file, "evidence"); await POST(`/api/me/tasks/${t.id}/complete`, body); toast(official ? "Submitted for review" : "Task completed"); onDone?.(); } });
}

// ================= DASHBOARD =================
const WIDGETS = [
  { id: "audit", title: "Daily audit" }, { id: "posting", title: "Posting progress" }, { id: "tasks", title: "Tasks" }, { id: "clients", title: "Clients" },
  { id: "earnings", title: "Earnings" }, { id: "platforms", title: "Platform activity" }, { id: "ranking", title: "Performance ranking" }, { id: "notifications", title: "Recent notifications" },
];
async function dashboard(el, ctx) {
  const d = await GET("/api/me/dashboard"), u = ctx.user;
  const hour = new Date(Date.now() + 8 * 3600e3).getUTCHours(); const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  let layout = (u.dashboard_layout && Array.isArray(u.dashboard_layout) ? u.dashboard_layout : []).filter((w) => WIDGETS.some((x) => x.id === w.id));
  for (const w of WIDGETS) if (!layout.some((x) => x.id === w.id)) layout.push({ id: w.id, hidden: false });
  let editing = false;
  const clockEl = h("span", { class: "mono" }); const tick = () => (clockEl.textContent = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila", weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }));
  tick(); const iv = setInterval(tick, 15000);
  const auditChip = chip(d.audit.status === "not_started" ? "pending" : d.audit.status, d.audit.status === "not_started" ? "Not started" : label(d.audit.status));
  const pct = d.target ? Math.min(100, Math.round((d.posts.today / d.target) * 100)) : 0;
  const widgetBody = {
    audit: () => h("div", { class: "col" }, h("div", { class: "row sp" }, h("span", { class: "muted" }, "Today"), auditChip), h("button", { class: "btn primary", onclick: () => (location.hash = "#/audit") }, d.audit.status === "submitted" || d.audit.status === "approved" ? "View audit" : "Open daily audit")),
    posting: () => h("div", { class: "col" }, h("div", { class: "row sp" }, h("b", { class: "mono" }, `${d.posts.today} / ${d.target}`), h("span", { class: "muted small" }, `${pct}% of daily goal`)), h("div", { class: "bar" }, h("i", { style: { width: pct + "%" } })), h("div", { class: "row sp small muted" }, h("span", {}, `${d.posts.verified} verified`), h("span", {}, `${d.posts.valid} total valid`))),
    tasks: () => h("div", { class: "col" }, h("div", { class: "grid g3" }, [["Assigned", d.tasks.assigned], ["Completed", d.tasks.completed], ["Pending", d.tasks.pending]].map(([k, v]) => h("div", {}, h("div", { class: "muted small" }, k), h("b", { style: { fontSize: "20px" } }, v)))),
      d.tasks.overdue ? chip("overdue", d.tasks.overdue + " overdue") : null,
      d.upcoming.length ? h("div", { class: "list" }, d.upcoming.slice(0, 3).map((t) => h("div", { class: "li" }, h("div", { class: "grow" }, h("div", {}, t.title), h("div", { class: "muted small" }, t.deadline ? fdt(t.deadline) : "No deadline")), t.effective_status === "overdue" ? chip("overdue") : null))) : h("div", { class: "muted small" }, "No open tasks."),
      h("a", { href: "#/tasks" }, "All tasks →")),
    clients: () => h("div", { class: "grid g3" }, [["Active", d.clients.active], ["Acquired", d.clients.acquired], ["Verified posts", d.posts.verified]].map(([k, v]) => h("div", {}, h("div", { class: "muted small" }, k), h("b", { style: { fontSize: "20px" } }, v)))),
    earnings: () => h("div", { class: "col" }, detailRows([["Potential earnings", h("b", {}, money(d.earnings.total_potential))], ["Locked commissions", money(d.earnings.locked)], ["Released commissions", money(d.earnings.released)], ["Tips & bonuses", money(Number(d.earnings.tips_total) + Number(d.earnings.bonuses_total))]]), h("a", { href: "#/earnings" }, "Earnings details →")),
    platforms: () => d.platform_activity.length ? h("div", { class: "col" }, d.platform_activity.map((p) => { const max = d.platform_activity[0].posts; return h("div", {}, h("div", { class: "row sp small" }, h("span", {}, p.platform), h("b", {}, p.posts)), h("div", { class: "bar" }, h("i", { style: { width: (p.posts / max) * 100 + "%" } }))); })) : h("div", { class: "muted small" }, "No posts in the last 30 days."),
    ranking: () => h("div", { class: "row" }, h("div", { style: { fontSize: "34px", fontWeight: 700, letterSpacing: "-.03em" } }, d.rank.position ? "#" + d.rank.position : "—"), h("div", {}, h("div", { class: "muted small" }, `of ${d.rank.of} staff · last 30 days`), h("div", {}, `Score ${d.rank.score}/100`))),
    notifications: () => d.notifications.length ? h("div", { class: "list" }, d.notifications.slice(0, 4).map((n) => h("div", { class: "li" }, h("div", { class: "grow" }, h("div", { style: { fontWeight: n.read_at ? 400 : 650 } }, n.title), h("div", { class: "muted small" }, ago(n.created_at))), n.read_at ? null : h("span", { class: "chip info" }, "New")))) : h("div", { class: "muted small" }, "You're all caught up."),
  };
  const grid = h("div", { class: "grid g2" });
  const draw = () => {
    clear(grid);
    layout.forEach((w, i) => {
      if (w.hidden && !editing) return; const def = WIDGETS.find((x) => x.id === w.id);
      const ctl = editing ? h("div", { class: "widget-ctl" }, h("button", { class: "icon-btn", style: { width: "32px", height: "32px" }, "aria-label": "Move up", disabled: i === 0, onclick: () => { [layout[i - 1], layout[i]] = [layout[i], layout[i - 1]]; draw(); } }, icon("chevu", 16)),
        h("button", { class: "icon-btn", style: { width: "32px", height: "32px" }, "aria-label": "Move down", disabled: i === layout.length - 1, onclick: () => { [layout[i + 1], layout[i]] = [layout[i], layout[i + 1]]; draw(); } }, icon("chevd", 16)),
        h("button", { class: "btn sm", onclick: () => { w.hidden = !w.hidden; draw(); } }, w.hidden ? "Show" : "Hide")) : null;
      grid.appendChild(h("div", { class: "card", style: { "--i": i, opacity: w.hidden ? 0.5 : 1 } }, h("div", { class: "card-h" }, h("h3", {}, def.title), ctl), widgetBody[w.id]()));
    });
  };
  draw();
  const custom = h("button", { class: "btn sm ghost", onclick: async () => { if (editing) { try { await PUT("/api/me/layout", { layout }); toast("Layout saved"); } catch (e) { return fail(e); } } editing = !editing; custom.textContent = editing ? "Save layout" : "Customize"; draw(); } }, "Customize");
  el.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, `${greet}, ${u.full_name.split(" ")[0]}`), h("p", {}, clockEl, " PH time"))),
    h("div", { class: "row quick", style: { marginBottom: "16px" } }, [["Add post", "plus", () => addPostFlow(ctx.reload)], ["New note", "notes", async () => { try { await POST("/api/me/notes", { title: "", body: "", type: "personal" }); location.hash = "#/notes"; } catch (e) { fail(e); } }],
      ["Add client", "users", () => clientForm(null, ctx.reload)], ["Complete task", "tasks", () => quickComplete(ctx)], ["Submit audit", "clip", () => (location.hash = "#/audit")]].map(([t, ic, fn]) => h("button", { class: "btn", onclick: fn }, icon(ic, 17), t))),
    h("div", { class: "grid g4", style: { marginBottom: "14px" } }, stat("Posts today", d.posts.today, `Goal ${d.target}`, { i: 0 }), stat("Pending tasks", d.tasks.pending, d.tasks.overdue ? d.tasks.overdue + " overdue" : "On track", { i: 1 }), stat("Active clients", d.clients.active, `${d.clients.acquired} acquired`, { i: 2 }), stat("Potential earnings", d.earnings.total_potential, "Commissions, tips, bonuses", { money: true, dark: true, i: 3 })),
    h("div", { class: "row sp", style: { marginBottom: "10px" } }, h("h2", {}, "Overview"), custom), grid);
  return { cleanup: () => clearInterval(iv) };
}
async function quickComplete(ctx) {
  const { tasks } = await GET("/api/me/tasks"); const open = tasks.filter((t) => ["not_started", "in_progress", "overdue"].includes(t.effective_status) && !t.parent_id);
  if (!open.length) return toast("No open tasks to complete");
  const f = formModal({ title: "Complete a task", submitText: "Continue", fields: [{ name: "id", label: "Task", type: "select", options: open.map((t) => ({ value: t.id, label: t.title })) }], onSubmit: async (v) => { const t = open.find((x) => String(x.id) === String(v.id)); setTimeout(() => completeFlow(t, ctx.reload), 250); } });
}

// ================= TASKS =================
async function tasksView(el, ctx) {
  let filter = { status: "", priority: "", q: "", kind: "" };
  const list = h("div", { class: "card", style: { padding: 0 } });
  const stat_ = [{ value: "", label: "All" }, { value: "not_started", label: "To do" }, { value: "in_progress", label: "In progress" }, { value: "under_review", label: "Review" }, { value: "overdue", label: "Overdue" }, { value: "completed", label: "Done" }];
  async function load() {
    clear(list).appendChild(h("div", { style: { padding: "14px" } }, h("div", { class: "sk", style: { height: "48px" } })));
    let tasks; try { ({ tasks } = await GET("/api/me/tasks", filter)); } catch (e) { return fail(e); }
    clear(list); const parents = tasks.filter((t) => !t.parent_id), subs = tasks.filter((t) => t.parent_id);
    if (!parents.length) return list.appendChild(empty("No tasks found", "Create a task or change your filters.", "tasks"));
    parents.forEach((t) => list.appendChild(taskRow(t, subs.filter((s) => s.parent_id === t.id))));
  }
  function taskRow(t, subs) {
    const done = ["completed", "under_review"].includes(t.status), ck = t.checklist || [];
    const tick = h("button", { class: "tick" + (done ? " done" : ""), "aria-label": "Complete task", disabled: done || t.status === "cancelled", onclick: async (e) => { e.stopPropagation(); try { await completeFlow(t, load); } catch (x) { fail(x); } } }, done ? icon("check", 14) : null);
    return h("div", { class: "task", style: { cursor: "pointer" }, onclick: () => taskDetail(t, subs) }, tick,
      h("div", { class: "grow" }, h("div", { style: { fontWeight: 600, textDecoration: t.status === "completed" ? "line-through" : "none" } }, t.title),
        h("div", { class: "row small muted", style: { gap: "8px", marginTop: "4px" } }, chip(t.effective_status), t.kind === "official" ? h("span", { class: "chip info" }, "Official") : null, h("span", { class: "prio-" + t.priority }, label(t.priority)), t.category ? h("span", {}, t.category) : null,
          t.deadline ? h("span", {}, icon("cal", 13), " ", fdt(t.deadline)) : null, t.recurrence !== "none" ? h("span", {}, "↻ " + label(t.recurrence)) : null, ck.length ? h("span", {}, `${ck.filter((i) => i.done).length}/${ck.length}`) : null, subs.length ? h("span", {}, `${subs.length} subtask${subs.length > 1 ? "s" : ""}`) : null),
        t.review_note ? h("div", { class: "small", style: { color: "var(--warn)", marginTop: "4px" } }, "Reviewer: " + t.review_note) : null));
  }
  function taskDetail(t, subs) {
    const editable = t.kind === "personal"; const lockedOfficial = t.kind === "official" && ["under_review", "completed", "cancelled"].includes(t.status);
    const ckBox = h("div", {}, (t.checklist || []).map((it, i) => h("label", { class: "ck" + (it.done ? " done" : "") }, h("input", { type: "checkbox", checked: it.done, disabled: lockedOfficial, onchange: async (e) => { t.checklist[i].done = e.target.checked; try { await PATCH("/api/me/tasks/" + t.id, { checklist: t.checklist }); } catch (x) { fail(x); } } }), h("span", {}, it.text))));
    const body = h("div", { class: "col" }, t.description ? h("p", { class: "preview-box" }, t.description) : null,
      detailRows([["Status", chip(t.effective_status)], ["Priority", label(t.priority)], ["Category", t.category || null], ["Deadline", t.deadline ? fdt(t.deadline) : null], ["Created", fdt(t.created_at)], ["Related client", t.client_name], ["Platform", t.platform_name], ["Completed", t.completed_at ? fdt(t.completed_at) : null], ["Type", t.kind === "official" ? "Official (assigned by admin)" : "Personal"]]),
      (t.checklist || []).length ? h("div", {}, h("h3", {}, "Checklist"), ckBox) : null,
      t.evidence_text || t.evidence_file ? h("div", {}, h("h3", {}, "Evidence"), h("p", { class: "preview-box" }, t.evidence_text), fileLink(t.evidence_file)) : null,
      subs.length ? h("div", {}, h("h3", {}, "Subtasks"), subs.map((s) => h("div", { class: "li" }, h("button", { class: "tick" + (s.status === "completed" ? " done" : ""), disabled: s.status === "completed", onclick: async () => { try { await completeFlow(s, () => { m.close(); load(); }); } catch (x) { fail(x); } } }, s.status === "completed" ? icon("check", 14) : null), h("span", { class: "grow" }, s.title)))) : null);
    const acts = [];
    if (!["completed", "under_review", "cancelled"].includes(t.status)) {
      acts.push(h("button", { class: "btn", onclick: async () => { try { await PATCH("/api/me/tasks/" + t.id, { status: t.status === "in_progress" ? "not_started" : "in_progress" }); m.close(); load(); } catch (x) { fail(x); } } }, t.status === "in_progress" ? "Mark not started" : "Start"));
      acts.push(h("button", { class: "btn primary", onclick: () => { m.close(); completeFlow(t, load).catch(fail); } }, t.kind === "official" ? "Submit for review" : "Complete"));
    }
    if (editable) { acts.unshift(h("button", { class: "btn danger", onclick: async () => { if (await confirmDialog({ title: "Delete task?", message: "This cannot be undone.", confirmText: "Delete", danger: true })) { try { await DEL("/api/me/tasks/" + t.id); m.close(); load(); } catch (x) { fail(x); } } } }, "Delete"), h("button", { class: "btn", onclick: () => { m.close(); taskForm(t, load).catch(fail); } }, "Edit"), h("button", { class: "btn", onclick: () => { m.close(); taskForm(null, load, t).catch(fail); } }, "Add subtask")); }
    const m = modal({ title: t.title, body, actions: acts, wide: false });
  }
  const search = h("input", { type: "search", placeholder: "Search tasks  ( / )", "aria-label": "Search tasks", oninput: (() => { let tm; return (e) => { clearTimeout(tm); tm = setTimeout(() => { filter.q = e.target.value; load(); }, 250); }; })() });
  const pr = h("select", { "aria-label": "Priority", onchange: (e) => { filter.priority = e.target.value; load(); } }, h("option", { value: "" }, "Any priority"), PRIORITY.map((p) => h("option", { value: p }, label(p))));
  const kd = h("select", { "aria-label": "Type", onchange: (e) => { filter.kind = e.target.value; load(); } }, h("option", { value: "" }, "All tasks"), h("option", { value: "official" }, "Official"), h("option", { value: "personal" }, "Personal"));
  el.append(pageHead("Tasks", "Your assigned work and personal to-dos", h("button", { class: "btn primary", onclick: () => taskForm(null, load).catch(fail) }, icon("plus", 17), "New task")),
    h("div", { class: "filters" }, seg(stat_, "", (v) => { filter.status = v; load(); }), search, pr, kd), list);
  await load();
}

// ================= PLATFORMS =================
async function platformsView(el, ctx) {
  const { platforms, kinds } = await GET("/api/me/platforms");
  const form = (p) => formModal({ title: p ? "Edit platform" : "Add platform", intro: "Never enter passwords or login details here — only the public profile or page name and URL.",
    fields: [{ name: "kind", label: "Platform", type: "select", options: kinds, value: p?.kind || "Facebook", required: true }, { name: "name", label: "Display name", value: p?.name, required: true, help: "e.g. Facebook – Main Page. For \"Other\", type the platform name.", max: 80 },
      { name: "profile_name", label: "Profile or page name", value: p?.profile_name, max: 120 }, { name: "profile_url", label: "Profile URL", type: "url", value: p?.profile_url, placeholder: "https://", max: 500 }],
    onSubmit: async (v) => { p ? await PATCH("/api/me/platforms/" + p.id, v) : await POST("/api/me/platforms", v); toast("Platform saved"); ctx.reload(); } });
  el.append(pageHead("Platforms", "Where you market and find clients", h("button", { class: "btn primary", onclick: () => form(null) }, icon("plus", 17), "Add platform")));
  if (!platforms.length) return el.appendChild(h("div", { class: "card" }, empty("No platforms yet", "Add the pages and profiles you use to post and acquire clients.", "globe"), h("div", { class: "row", style: { justifyContent: "center" } }, h("button", { class: "btn primary", onclick: () => form(null) }, "Add your first platform"))));
  el.appendChild(h("div", { class: "grid auto" }, platforms.map((p, i) => h("div", { class: "card", style: { "--i": i, opacity: p.active ? 1 : 0.6 } },
    h("div", { class: "card-h" }, h("div", {}, h("h3", {}, p.name), h("div", { class: "muted small" }, p.profile_name || p.kind)), p.active ? null : chip("cancelled", "Inactive")),
    h("div", { class: "grid g3", style: { margin: "8px 0 12px" } }, [["Posts", p.posts], ["Verified", p.verified_posts], ["Clients", p.clients]].map(([k, v]) => h("div", {}, h("div", { class: "muted tiny" }, k), h("b", { style: { fontSize: "19px" } }, v)))),
    h("div", { class: "muted small" }, "Last activity: " + (p.last_activity ? fdate(p.last_activity) : "none")),
    p.profile_url ? h("div", { class: "small", style: { marginTop: "6px", wordBreak: "break-all" } }, h("a", { href: p.profile_url, target: "_blank", rel: "noopener noreferrer" }, p.profile_url)) : null,
    h("div", { class: "row", style: { marginTop: "12px" } }, h("button", { class: "btn sm", onclick: () => form(p) }, "Edit"), h("button", { class: "btn sm", onclick: async () => { try { await PATCH("/api/me/platforms/" + p.id, { active: !p.active }); ctx.reload(); } catch (e) { fail(e); } } }, p.active ? "Deactivate" : "Activate"),
      h("button", { class: "btn sm danger", onclick: async () => { if (await confirmDialog({ title: "Delete platform?", message: "Platforms with posts or clients can't be deleted — deactivate them instead.", confirmText: "Delete", danger: true })) try { await DEL("/api/me/platforms/" + p.id); ctx.reload(); } catch (e) { fail(e); } } }, "Delete"))))));
}

// ================= POSTS =================
async function postsView(el, ctx) {
  const po = await platformOptions("Choose platform");
  let range = {}, filt = { platform: "", status: "" };
  const links = h("textarea", { rows: 5, placeholder: "Paste one or many post links here…", "aria-label": "Post links" });
  const countEl = h("span", { class: "chip" }, "0 valid links");
  links.addEventListener("input", () => { const t = links.value.split(/[\s,]+/).filter(Boolean); const v = new Set(t.filter((x) => /^https?:\/\/[^\s]+\.[^\s]+/i.test(x))); countEl.textContent = `${v.size} valid link${v.size === 1 ? "" : "s"}` + (t.length - v.size ? ` · ${t.length - v.size} invalid` : ""); countEl.className = "chip " + (v.size ? "ok" : ""); });
  const sel = h("select", { "aria-label": "Platform" }, po.map((o) => h("option", { value: o.value }, o.label)));
  const title = h("input", { placeholder: "Title or description (optional)", maxlength: 300 }), camp = h("input", { placeholder: "Campaign (optional)", maxlength: 120 }), date = h("input", { type: "date", value: phToday(), max: phToday() }), shot = h("input", { type: "file", accept: "image/*" });
  const btn = h("button", { class: "btn primary", onclick: async () => {
    if (!sel.value) return toast("Choose a platform", true); if (!links.value.trim()) return toast("Paste at least one link", true);
    btn.disabled = true; try { const r = await POST("/api/me/posts", { platform_id: sel.value, links: links.value, title: title.value, campaign: camp.value, posted_on: date.value, screenshot_file: await upload(shot.files[0], "screenshot") });
      toast(`${r.valid} valid link${r.valid === 1 ? "" : "s"} added${r.duplicates ? `, ${r.duplicates} duplicate (not counted)` : ""}${r.invalid.length ? `, ${r.invalid.length} invalid skipped` : ""}`); links.value = ""; title.value = ""; shot.value = ""; links.dispatchEvent(new Event("input")); loadHistory(); } catch (e) { fail(e); } finally { btn.disabled = false; } } }, "Submit posts");
  const hist = h("div"), sum = h("div", { class: "row" });
  async function loadHistory() {
    clear(hist).appendChild(h("div", { class: "sk", style: { height: "120px" } }));
    try {
      const d = await GET("/api/me/posts", { ...range, ...filt }); clear(sum).append(h("span", { class: "chip" }, d.summary.total + " submitted"), h("span", { class: "chip ok" }, d.summary.verified + " verified"), h("span", { class: "chip info" }, d.summary.valid + " counted"), d.summary.duplicates ? h("span", { class: "chip bad" }, d.summary.duplicates + " duplicate") : null, d.summary.rejected ? h("span", { class: "chip bad" }, d.summary.rejected + " rejected") : null);
      clear(hist).appendChild(table([{ label: "Date", render: (p) => fdate(p.posted_on) }, { label: "Platform", render: (p) => p.platform_name || "—" }, { label: "Link", render: (p) => h("a", { href: p.url, target: "_blank", rel: "noopener noreferrer", style: { wordBreak: "break-all" } }, p.url.length > 52 ? p.url.slice(0, 52) + "…" : p.url) },
        { label: "Title", render: (p) => p.title || "—" }, { label: "Status", render: (p) => chip(p.status) }, { label: "Time", render: (p) => ftime(p.submitted_at) }, { label: "", act: true, render: (p) => (p.status === "verified" ? null : h("button", { class: "btn sm danger", onclick: async () => { if (await confirmDialog({ title: "Delete post?", message: "Remove this post record?", confirmText: "Delete", danger: true })) try { await DEL("/api/me/posts/" + p.id); loadHistory(); } catch (e) { fail(e); } } }, "Delete")) }], d.posts, { emptyTitle: "No posts in this period", emptyText: "Submitted posts will appear here." }));
    } catch (e) { fail(e); }
  }
  const rb = rangeBar((r) => { range = r; loadHistory(); }, "week"); range = rb.get();
  const fp = h("select", { "aria-label": "Filter platform", onchange: (e) => { filt.platform = e.target.value; loadHistory(); } }, po.map((o) => h("option", { value: o.value }, o.value ? o.label : "All platforms")));
  const fs = h("select", { "aria-label": "Filter status", onchange: (e) => { filt.status = e.target.value; loadHistory(); } }, h("option", { value: "" }, "Any status"), ["pending", "verified", "rejected", "duplicate"].map((s) => h("option", { value: s }, label(s))));
  el.append(pageHead("Add Post", "Submit post links individually or in bulk"),
    h("div", { class: "card" }, h("div", { class: "form" }, h("div", { class: "two" }, h("label", { class: "f" }, "Platform", sel), h("label", { class: "f" }, "Posting date", date)), h("label", { class: "f" }, "Post link(s)", links, h("div", {}, countEl)),
      h("div", { class: "two" }, h("label", { class: "f" }, "Title / description", title), h("label", { class: "f" }, "Campaign", camp)), h("label", { class: "f" }, "Screenshot (optional)", shot), h("div", { class: "row" }, btn,
        h("span", { class: "muted small" }, "Duplicate links are detected automatically and never raise your verified score.")))),
    h("div", { class: "row sp", style: { margin: "22px 0 12px" } }, h("h2", {}, "Posting history"), h("button", { class: "btn sm", onclick: () => download("/api/me/export/posts", range, "my-posts.csv").catch(fail) }, icon("download", 15), "Export")),
    h("div", { class: "filters" }, rb.el, fp, fs), sum, h("div", { style: { marginTop: "12px" } }, hist));
  await loadHistory();
}

// ================= CLIENTS =================
async function clientsView(el, ctx) {
  let f = { q: "", status: "" }; const box = h("div");
  async function load() {
    try {
      const { clients } = await GET("/api/me/clients", f); clear(box).appendChild(table([
        { label: "Client", render: (c) => h("div", {}, h("b", {}, c.name), h("div", { class: "muted small" }, c.service || c.contact || "")) }, { label: "Price", cls: "mono", render: (c) => money(c.price) }, { label: "Verified paid", cls: "mono", render: (c) => money(c.verified_paid) },
        { label: "Balance", cls: "mono", render: (c) => money(c.balance) }, { label: "Commission", render: (c) => (c.commission_status ? h("span", {}, chip(c.commission_status), " ", money(c.commission_amount)) : "—") },
        { label: "Status", render: (c) => h("div", { class: "row", style: { gap: "6px" } }, chip(c.status), c.confirmed_at ? chip("verified", "Confirmed") : chip("pending", "Unconfirmed")) }], clients, { emptyTitle: "No clients yet", emptyText: "Add your first client to start tracking payments and commissions.", onRow: (c) => detail(c.id) }));
    } catch (e) { fail(e); }
  }
  async function detail(id) {
    const d = await GET("/api/me/clients/" + id), c = d.client;
    const pay = table([{ label: "Type", render: (p) => label(p.kind) }, { label: "Amount", cls: "mono", render: (p) => money(p.amount) }, { label: "Date", render: (p) => fdate(p.paid_on) }, { label: "Status", render: (p) => chip(p.status) }, { label: "Proof", render: (p) => fileLink(p.receipt_file, "Receipt") || "—" },
      { label: "", act: true, render: (p) => (p.status === "pending" ? h("button", { class: "btn sm danger", onclick: async () => { try { await DEL("/api/me/payments/" + p.id); m.close(); detail(id); load(); } catch (e) { fail(e); } } }, "Remove") : p.review_note ? h("span", { class: "small muted" }, p.review_note) : null) }], d.payments, { emptyTitle: "No payments yet" });
    const hasInitial = d.payments.some((p) => p.kind === "initial" && p.status !== "rejected"), canPay = c.status !== "cancelled" && Number(c.price) > 0 && Number(c.balance) > 0;
    const body = h("div", { class: "col" }, detailRows([["Contact", c.contact], ["Service", c.service], ["Project price", money(c.price)], ["Verified paid", money(c.verified_paid)], ["Awaiting verification", money(c.pending_paid)], ["Remaining balance", h("b", {}, money(c.balance))], ["Commission", c.commission_status ? `${label(c.commission_status)} · ${money(c.commission_amount)}` : "None yet"], ["Platform", c.platform_name], ["Acquired", fdate(c.acquired_on)], ["Notes", c.notes]]),
      Number(c.price) <= 0 ? h("p", { class: "small", style: { color: "var(--warn)" } }, "Set the project price (Edit) before recording payments.") : null, h("h3", {}, "Payments"), pay,
      d.tips.length ? h("div", {}, h("h3", {}, "Tips"), d.tips.map((t) => h("div", { class: "li" }, h("span", { class: "grow" }, money(t.amount) + (t.note ? " · " + t.note : "")), chip(t.status)))) : null);
    const m = modal({ title: c.name, body, wide: true, actions: [h("button", { class: "btn", onclick: () => { m.close(); clientForm(c, load); } }, "Edit"), h("button", { class: "btn", onclick: () => { m.close(); tipForm(c.id, load).catch(fail); } }, "Add tip"),
      canPay ? h("button", { class: "btn primary", onclick: () => { m.close(); paymentForm(c, hasInitial ? "remaining" : "initial", () => { load(); detail(id); }); } }, hasInitial ? "Record remaining payment" : "Record initial payment") : null] });
  }
  const search = h("input", { type: "search", placeholder: "Search clients  ( / )", oninput: (() => { let t; return (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; load(); }, 250); }; })() });
  el.append(pageHead("Clients", "Clients you acquired and their payments", h("button", { class: "btn primary", onclick: () => clientForm(null, load).catch(fail) }, icon("plus", 17), "Add client")),
    h("div", { class: "filters" }, search, h("select", { onchange: (e) => { f.status = e.target.value; load(); }, "aria-label": "Status" }, h("option", { value: "" }, "All statuses"), ["active", "completed", "cancelled"].map((s) => h("option", { value: s }, label(s)))), h("button", { class: "btn sm", onclick: () => tipForm(null, load).catch(fail) }, icon("gift", 15), "Record tip")), box);
  await load();
}

startApp({ role: "staff", title: "Dashboard", nav: NAV, mobile: ["dashboard", "tasks", "posts", "notes", "more"],
  routes: { default: "dashboard", dashboard: { title: "Dashboard", render: dashboard }, tasks: { title: "Tasks", render: tasksView }, posts: { title: "Add Post", render: postsView }, notes: { title: "Notes", render: notesView }, clients: { title: "Clients", render: clientsView },
    audit: { title: "Daily Audit", render: auditView }, earnings: { title: "Earnings", render: earningsView }, platforms: { title: "Platforms", render: platformsView }, notifications: { title: "Notifications", render: notificationsView }, profile: { title: "Profile", render: profileView } } });
