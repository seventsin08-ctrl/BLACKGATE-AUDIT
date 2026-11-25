import { h, clear, GET, POST, PATCH, PUT, DEL, icon, toast, fail, modal, confirmDialog, formModal, table, empty, stat, chip, label, money, fdate, fdt, ftime, ago, phToday, addDays, pageHead, seg, avatar, detailRows, upload, fileLink, download, enableBrowserNotifications, toggleTheme } from "./core.js";

// ================= NOTES =================
export async function notesView(el, ctx) {
  const st = { view: "all", folder: "", type: "", q: "", notes: [], folders: [], active: null };
  const [{ tasks }, { clients }] = await Promise.all([GET("/api/me/tasks"), GET("/api/me/clients")]);
  const wrap = h("div", { class: "notes" }), side = h("div", { class: "nf" }), listEl = h("div", { class: "nl" }), edEl = h("div", { class: "ned-wrap" });
  wrap.append(side, listEl, h("div", {}, edEl));
  const views = [["all", "All notes", "notes"], ["pinned", "Pinned", "pin"], ["archived", "Archived", "archive"], ["trash", "Recently deleted", "trash"]];
  async function load(keepActive = true) {
    const q = { view: st.view, folder: st.folder, type: st.type, q: st.q };
    const d = await GET("/api/me/notes", q); st.notes = d.notes; st.folders = d.folders;
    if (!keepActive || !st.notes.some((n) => n.id === st.active)) st.active = null;
    drawSide(); drawList(); drawEditor();
  }
  function drawSide() {
    clear(side);
    views.forEach(([v, t, ic]) => side.appendChild(h("button", { class: "nav-item" + (st.view === v && !st.folder ? " active" : ""), onclick: () => { st.view = v; st.folder = ""; load(false); } }, icon(ic, 17), h("span", {}, t))));
    side.appendChild(h("div", { class: "row sp", style: { margin: "14px 4px 6px" } }, h("b", { class: "small muted" }, "FOLDERS"), h("button", { class: "icon-btn", style: { width: "28px", height: "28px" }, "aria-label": "New folder", onclick: () => formModal({ title: "New folder", fields: [{ name: "name", label: "Folder name", required: true, max: 60 }], onSubmit: async (v) => { await POST("/api/me/folders", v); load(); } }) }, icon("plus", 16))));
    st.folders.forEach((f) => side.appendChild(h("div", { class: "row", style: { gap: 0, flexWrap: "nowrap" } }, h("button", { class: "nav-item grow" + (st.folder == f.id ? " active" : ""), onclick: () => { st.view = "all"; st.folder = f.id; load(false); } }, icon("folder", 17), h("span", {}, f.name), h("span", { class: "muted tiny", style: { marginLeft: "auto" } }, f.count)),
      h("button", { class: "icon-btn", style: { width: "28px", height: "28px" }, "aria-label": "Folder options", onclick: () => formModal({ title: "Rename folder", submitText: "Rename", fields: [{ name: "name", label: "Folder name", value: f.name, required: true }], onSubmit: async (v) => { await PATCH("/api/me/folders/" + f.id, v); load(); } }).then(() => {}) }, icon("edit", 14)),
      h("button", { class: "icon-btn", style: { width: "28px", height: "28px" }, "aria-label": "Delete folder", onclick: async () => { if (await confirmDialog({ title: "Delete folder?", message: "Notes inside are kept and moved out of the folder.", confirmText: "Delete", danger: true })) { try { await DEL("/api/me/folders/" + f.id); if (st.folder == f.id) st.folder = ""; load(); } catch (e) { fail(e); } } } }, icon("trash", 14)))));
    side.appendChild(h("div", { style: { margin: "14px 4px 6px" } }, h("b", { class: "small muted" }, "TYPE")));
    [["", "All types"], ["personal", "Personal"], ["work", "Work (shared)"]].forEach(([v, t]) => side.appendChild(h("button", { class: "nav-item" + (st.type === v ? " active" : ""), onclick: () => { st.type = v; load(); } }, h("span", {}, t))));
  }
  function drawList() {
    clear(listEl);
    const search = h("input", { type: "search", placeholder: "Search notes  ( / )", value: st.q, "aria-label": "Search notes", style: { margin: "10px", width: "calc(100% - 20px)" }, oninput: (() => { let t; return (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; load(); }, 250); }; })() });
    listEl.append(h("div", { class: "row sp", style: { padding: "10px 10px 0" } }, h("b", {}, views.find((v) => v[0] === st.view)[1]), st.view !== "trash" ? h("button", { class: "btn sm primary", onclick: newNote }, icon("plus", 15), "New") : null), search);
    if (!st.notes.length) listEl.appendChild(empty(st.view === "trash" ? "Nothing deleted" : "No notes", st.view === "trash" ? "Deleted notes are kept for 30 days." : "Create your first note.", "notes"));
    st.notes.forEach((n) => listEl.appendChild(h("div", { class: "nitem" + (n.id === st.active ? " active" : "") + (n.type === "work" ? " tag-work" : ""), onclick: () => { st.active = n.id; drawList(); drawEditor(); wrap.classList.add("editing"); } },
      h("b", {}, (n.pinned ? "📌 " : "") + (n.title || "Untitled")), h("span", {}, (n.body || (n.checklist || []).map((c) => c.text).join(", ") || "No additional text").slice(0, 80)), h("span", { class: "tiny" }, (n.type === "work" ? "Work · " : "") + fdt(n.updated_at)))));
  }
  async function newNote() { try { const { note } = await POST("/api/me/notes", { title: "", body: "", type: "personal", folder_id: st.folder || null }); st.view = "all"; await load(); st.active = note.id; drawList(); drawEditor(); wrap.classList.add("editing"); edEl.querySelector(".t")?.focus(); } catch (e) { fail(e); } }
  function drawEditor() {
    clear(edEl); const n = st.notes.find((x) => x.id === st.active);
    if (!n) return edEl.appendChild(empty("Select a note", "Or create a new one.", "notes"));
    const status = h("span", { class: "muted tiny" }, "Last edited " + fdt(n.updated_at));
    let timer; const trashed = !!n.deleted_at;
    const save = (patch) => { if (trashed) return; Object.assign(n, patch); status.textContent = "Saving…"; clearTimeout(timer); timer = setTimeout(async () => { try { const r = await PATCH("/api/me/notes/" + n.id, patch); Object.assign(n, r.note); status.textContent = "Saved " + ftime(r.note.updated_at); const li = listEl.querySelector(".nitem.active"); if (li) { li.querySelector("b").textContent = (n.pinned ? "📌 " : "") + (n.title || "Untitled"); li.querySelectorAll("span")[0].textContent = (n.body || "No additional text").slice(0, 80); } } catch (e) { status.textContent = "Not saved"; fail(e); } }, 700); };
    const title = h("input", { class: "t", value: n.title, placeholder: "Title", maxlength: 200, disabled: trashed, "aria-label": "Note title", oninput: (e) => save({ title: e.target.value }) });
    const body = h("textarea", { placeholder: "Start writing…", disabled: trashed, "aria-label": "Note body", oninput: (e) => save({ body: e.target.value }) }, n.body);
    const ckWrap = h("div"); const drawCk = () => { clear(ckWrap); (n.checklist || []).forEach((it, i) => ckWrap.appendChild(h("div", { class: "ck" + (it.done ? " done" : "") }, h("input", { type: "checkbox", checked: it.done, disabled: trashed, onchange: (e) => { n.checklist[i].done = e.target.checked; save({ checklist: n.checklist }); drawCk(); } }), h("input", { type: "text", value: it.text, disabled: trashed, maxlength: 300, oninput: (e) => { n.checklist[i].text = e.target.value; save({ checklist: n.checklist }); } }), trashed ? null : h("button", { class: "icon-btn", style: { width: "28px", height: "28px" }, "aria-label": "Remove item", onclick: () => { n.checklist.splice(i, 1); save({ checklist: n.checklist }); drawCk(); } }, icon("x", 14))))); }; drawCk();
    const typeSeg = seg([{ value: "personal", label: "Personal" }, { value: "work", label: "Work" }], n.type, (v) => { save({ type: v }); drawEditor(); });
    const folderSel = h("select", { disabled: trashed, "aria-label": "Folder", onchange: (e) => save({ folder_id: e.target.value || null }) }, h("option", { value: "" }, "No folder"), st.folders.map((f) => h("option", { value: f.id, selected: f.id === n.folder_id }, f.name)));
    const cat = h("input", { value: n.category, placeholder: "Category", maxlength: 60, disabled: trashed, "aria-label": "Category", oninput: (e) => save({ category: e.target.value }) });
    const taskSel = h("select", { disabled: trashed, "aria-label": "Linked task", onchange: (e) => save({ task_id: e.target.value || null }) }, h("option", { value: "" }, "No task"), tasks.filter((t) => !t.parent_id).map((t) => h("option", { value: t.id, selected: t.id === n.task_id }, t.title)));
    const cliSel = h("select", { disabled: trashed, "aria-label": "Linked client", onchange: (e) => save({ client_id: e.target.value || null }) }, h("option", { value: "" }, "No client"), clients.map((c) => h("option", { value: c.id, selected: c.id === n.client_id }, c.name)));
    edEl.appendChild(h("div", { class: "ned" },
      h("div", { class: "row sp" }, h("button", { class: "btn sm ghost nback", onclick: () => wrap.classList.remove("editing") }, icon("back", 15), "Notes"), status, h("div", { class: "row", style: { gap: "4px" } },
        trashed ? h("button", { class: "btn sm", onclick: async () => { await POST(`/api/me/notes/${n.id}/restore`); toast("Note restored"); st.view = "all"; load(); } }, "Restore") : [
          h("button", { class: "icon-btn", "aria-label": n.pinned ? "Unpin" : "Pin", onclick: async () => { await PATCH("/api/me/notes/" + n.id, { pinned: !n.pinned }); load(); } }, icon("pin", 18)),
          h("button", { class: "icon-btn", "aria-label": n.archived ? "Unarchive" : "Archive", onclick: async () => { await PATCH("/api/me/notes/" + n.id, { archived: !n.archived }); toast(n.archived ? "Unarchived" : "Archived"); load(false); } }, icon("archive", 18))],
        h("button", { class: "icon-btn", "aria-label": trashed ? "Delete forever" : "Delete", onclick: async () => { if (trashed && !(await confirmDialog({ title: "Delete forever?", message: "This note will be permanently removed.", confirmText: "Delete forever", danger: true }))) return; try { await DEL("/api/me/notes/" + n.id); toast(trashed ? "Deleted forever" : "Moved to Recently Deleted"); wrap.classList.remove("editing"); load(false); } catch (e) { fail(e); } } }, icon("trash", 18)))),
      h("div", { class: "row" }, typeSeg, n.type === "work" ? h("span", { class: "chip info" }, "Shared with administrator") : h("span", { class: "chip" }, icon("lock", 12), " Private")),
      title, body, ckWrap, trashed ? null : h("button", { class: "btn sm", style: { alignSelf: "flex-start" }, onclick: () => { n.checklist = [...(n.checklist || []), { text: "", done: false }]; drawCk(); ckWrap.lastChild?.querySelector("input[type=text]")?.focus(); } }, icon("plus", 14), "Checklist item"),
      h("div", { class: "grid g2", style: { gap: "8px" } }, folderSel, cat, n.type === "work" ? taskSel : null, n.type === "work" ? cliSel : null)));
  }
  el.append(pageHead("Notes", "Private notes and work notes you can share with the administrator"), wrap);
  await load();
}

// ================= DAILY AUDIT =================
export async function auditView(el, ctx) {
  let date = phToday(), data, manual;
  const body = h("div"), clockEl = h("span", { class: "mono" });
  const iv = setInterval(() => (clockEl.textContent = new Date().toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", second: "2-digit" })), 1000);
  async function load(d) {
    if (d) date = d; clear(body).appendChild(h("div", { class: "sk b" }));
    try { data = await GET("/api/me/audits/prefill", { date }); } catch (e) { clear(body).appendChild(h("div", { class: "card" }, empty("Cannot open this audit", e.message, "clip"))); return; }
    manual = { ...data.manual, screenshots: [...(data.manual.screenshots || [])] }; draw();
  }
  const sec = (t, ...c) => h("div", { class: "card", style: { marginBottom: "14px" } }, h("h3", {}, t), ...c);
  const ta = (key, lab, ph) => h("label", { class: "f" }, lab, h("textarea", { rows: 3, placeholder: ph || "", disabled: !data.editable, maxlength: 4000, oninput: (e) => (manual[key] = e.target.value) }, manual[key] || ""));
  function draw() {
    clear(body); const s = data.snapshot, a = data.audit, ed = data.editable; const c = s.clients;
    const status = a ? a.status : "draft";
    body.append(
      a?.status === "correction_requested" ? h("div", { class: "card", style: { marginBottom: "14px", borderColor: "var(--warn)" } }, h("b", { style: { color: "var(--warn)" } }, "Correction requested"), h("p", {}, a.review_note || "Please review and resubmit.")) : null,
      a && ["submitted", "approved"].includes(a.status) ? h("div", { class: "card", style: { marginBottom: "14px" } }, h("div", { class: "row sp" }, h("span", {}, a.status === "approved" ? "This audit was approved and is locked." : "Submitted — awaiting administrator review. Locked."), chip(a.status)), a.review_note ? h("p", { class: "muted" }, a.review_note) : null) : null,
      sec("Audit details", h("div", { class: "grid g4" }, [["Staff", data.staff.name], ["Audit date", fdate(s.date)], ["Audit time", date === phToday() ? clockEl : (a?.submitted_at ? ftime(a.submitted_at) : "—")], ["Status", chip(status, a ? label(a.status) : "Draft")]].map(([k, v]) => h("div", {}, h("div", { class: "muted small" }, k), h("b", {}, v))))),
      sec("Posting accomplishments", s.posting.length ? h("div", { class: "col" }, s.posting.map((p) => h("div", {}, h("div", { class: "row sp" }, h("b", {}, p.platform), chip("info", p.count + " post" + (p.count > 1 ? "s" : ""))), h("ol", { style: { margin: "6px 0 0", paddingLeft: "22px", wordBreak: "break-all" }, class: "small" }, p.links.map((l) => h("li", {}, h("a", { href: l, target: "_blank", rel: "noopener noreferrer" }, l)))))), h("div", { class: "muted small" }, `Total ${s.total_posts} post${s.total_posts === 1 ? "" : "s"}` + (s.duplicate_posts ? ` · ${s.duplicate_posts} duplicate excluded` : ""))) : h("div", { class: "muted" }, "No posts recorded for this date. ", ed ? h("a", { href: "#/posts" }, "Add posts →") : null)),
      sec("Client accomplishments", h("div", { class: "grid g4" }, [["Clients acquired", c.count], ["Initial payments", money(c.initial_payments)], ["Remaining payments", money(c.remaining_payments_received)], ["Tips", money(c.tips)], ["Potential commission", money(c.potential_commission)], ["Project prices", money(c.acquired.reduce((x, y) => x + Number(y.price), 0))]].map(([k, v]) => h("div", {}, h("div", { class: "muted small" }, k), h("b", {}, v)))),
        c.acquired.length ? h("div", { style: { marginTop: "12px" } }, c.acquired.map((x) => h("div", { class: "li" }, h("div", { class: "grow" }, h("b", {}, x.name), h("div", { class: "muted small" }, x.service || "Service not specified")), h("div", { class: "right small mono" }, h("div", {}, money(x.price)), h("div", { class: "muted" }, "Remaining " + money(Math.max(0, x.price - x.paid))))))) : h("div", { class: "muted", style: { marginTop: "8px" } }, "No new clients on this date. ", ed ? h("a", { href: "#/clients" }, "Add a client →") : null)),
      sec("Task accomplishments", h("div", { class: "grid g2" }, h("div", {}, h("b", {}, `Completed (${s.tasks.completed.length})`), s.tasks.completed.length ? h("ul", { style: { margin: "6px 0 0", paddingLeft: "20px" } }, s.tasks.completed.map((t) => h("li", {}, t.title))) : h("div", { class: "muted small" }, "None")),
        h("div", {}, h("b", {}, `Incomplete (${s.tasks.incomplete.length})`), s.tasks.incomplete.length ? h("ul", { style: { margin: "6px 0 0", paddingLeft: "20px" } }, s.tasks.incomplete.map((t) => h("li", {}, t.title))) : h("div", { class: "muted small" }, "None"))), h("div", { style: { marginTop: "12px" } }, ta("progress", "Work progress", "Summarise your overall progress today"))),
      sec("Additional information", h("div", { class: "form" }, ta("work_notes", "Work notes"), ta("problems", "Problems encountered"), ta("followups", "Client follow-ups"), ta("plans", "Plans for the next working day"),
        h("div", {}, h("div", { class: "f", style: { fontSize: "13px", fontWeight: 600, color: "var(--text2)", marginBottom: "6px" } }, "Supporting screenshots (optional)"),
          h("div", { class: "row" }, manual.screenshots.map((id, i) => h("span", { class: "chip" }, fileLink(id, "Screenshot " + (i + 1)), ed ? h("button", { class: "icon-btn", style: { width: "20px", height: "20px" }, "aria-label": "Remove", onclick: () => { manual.screenshots.splice(i, 1); draw(); } }, icon("x", 12)) : null))),
          ed ? h("input", { type: "file", accept: "image/*", multiple: true, style: { marginTop: "8px" }, onchange: async (e) => { try { for (const f of e.target.files) manual.screenshots.push(await upload(f, "screenshot")); draw(); } catch (x) { fail(x); } } }) : null))),
      ed ? h("div", { class: "row", style: { position: "sticky", bottom: "calc(var(--bn-h) + 8px)", zIndex: 5 } }, h("button", { class: "btn", onclick: async () => { try { await PUT(`/api/me/audits/${date}`, { manual }); toast("Draft saved"); load(); } catch (e) { fail(e); } } }, "Save draft"), h("button", { class: "btn", onclick: preview }, "Preview"),
        h("button", { class: "btn primary", onclick: async () => { if (!(await confirmDialog({ title: "Submit audit?", message: "Once submitted, this audit is locked unless the administrator requests a correction.", confirmText: "Submit audit" }))) return; try { await POST(`/api/me/audits/${date}/submit`, { manual }); toast("Audit submitted"); load(); ctx.refreshBadge(); } catch (e) { fail(e); } } }, "Submit audit")) : null);
  }
  function preview() {
    const s = data.snapshot, c = s.clients; const line = (k, v) => v ? h("div", {}, h("b", {}, k + ": "), h("span", { class: "preview-box" }, v)) : null;
    modal({ title: `Audit preview · ${fdate(date)}`, wide: true, body: h("div", { class: "col" }, h("div", {}, h("b", {}, data.staff.name), " · ", fdate(date)),
      h("div", {}, h("h3", {}, "Posting"), s.posting.length ? s.posting.map((p) => h("div", {}, `${p.platform}: ${p.count} post(s)`, h("ol", { class: "small", style: { margin: "2px 0 8px", paddingLeft: "22px", wordBreak: "break-all" } }, p.links.map((l) => h("li", {}, l))))) : "No posts"),
      h("div", {}, h("h3", {}, "Clients"), `${c.count} acquired · Initial ${money(c.initial_payments)} · Remaining ${money(c.remaining_payments_received)} · Tips ${money(c.tips)} · Potential commission ${money(c.potential_commission)}`),
      h("div", {}, h("h3", {}, "Tasks"), `${s.tasks.completed.length} completed · ${s.tasks.incomplete.length} incomplete`), line("Progress", manual.progress), line("Work notes", manual.work_notes), line("Problems", manual.problems), line("Follow-ups", manual.followups), line("Next day plans", manual.plans)) });
  }
  const hist = h("div");
  async function loadHist() { const { audits } = await GET("/api/me/audits"); clear(hist).appendChild(table([{ label: "Date", render: (a) => fdate(a.audit_date) }, { label: "Status", render: (a) => chip(a.status) }, { label: "Revision", render: (a) => "v" + a.revision }, { label: "Submitted", render: (a) => (a.submitted_at ? fdt(a.submitted_at) : "—") }], audits, { emptyTitle: "No audits yet", onRow: (a) => { load(a.audit_date); scrollTo({ top: 0, behavior: "smooth" }); } })); }
  const days = Array.from({ length: 8 }, (_, i) => addDays(phToday(), -i));
  el.append(pageHead("Daily Audit", "Pre-filled from your posts, clients and tasks — nothing to enter twice", h("select", { "aria-label": "Audit date", style: { width: "auto" }, onchange: (e) => load(e.target.value) }, days.map((d) => h("option", { value: d }, d === phToday() ? "Today · " + fdate(d) : fdate(d))))), body, h("h2", { style: { margin: "26px 0 12px" } }, "Audit history"), hist);
  await Promise.all([load(), loadHist()]);
  return { cleanup: () => clearInterval(iv) };
}

// ================= EARNINGS =================
export async function earningsView(el, ctx) {
  const d = await GET("/api/me/earnings"), s = d.summary;
  el.append(pageHead("Earnings", "Commissions, tips and bonuses", h("button", { class: "btn sm", onclick: () => download("/api/me/export/commissions", {}, "my-commissions.csv").catch(fail) }, icon("download", 15), "Export")),
    h("div", { class: "grid g4", style: { marginBottom: "14px" } }, stat("Total potential earnings", s.total_potential, "Commissions + tips + bonuses", { money: true, dark: true, i: 0 }), stat("Locked commissions", s.locked, "Until client fully pays", { money: true, i: 1 }), stat("Eligible", s.eligible, "Awaiting approval", { money: true, i: 2 }), stat("Approved", s.approved, "Awaiting payout", { money: true, i: 3 })),
    h("div", { class: "grid g4", style: { marginBottom: "14px" } }, stat("Released commissions", s.released, "Paid out", { money: true, i: 4 }), stat("Tips", s.tips_total, s.tips_pending > 0 ? money(s.tips_pending) + " awaiting verification" : "Separate from commissions", { money: true, i: 5 }), stat("Bonuses", s.bonuses_total, `${money(s.bonuses_released)} released`, { money: true, i: 6 }), stat("Awaiting verification", s.awaiting_verification_estimate, "Estimated commission on unverified initial payments", { money: true, i: 7 })),
    h("div", { class: "card", style: { marginBottom: "14px" } }, h("h3", {}, "How commissions work"), h("p", { class: "muted" }, `Commission = verified initial payment × ${s.commission_rate_percent}%. It stays locked until the client has fully paid the agreed project price. Once the balance is paid and verified it becomes eligible for administrator approval, then is released as a payout. Example: ₱10,000 project, ₱5,000 initial → ₱${(5000 * s.commission_rate_percent / 100).toLocaleString()} commission, locked until the remaining ₱5,000 is verified. Tips are separate and never part of this calculation.`)),
    h("h2", { style: { margin: "20px 0 10px" } }, "Commissions"),
    table([{ label: "Client", render: (c) => c.client_name }, { label: "Project price", cls: "mono", render: (c) => money(c.client_price) }, { label: "Verified initial", cls: "mono", render: (c) => money(c.base_amount) }, { label: "Commission", cls: "mono", render: (c) => h("b", {}, money(c.amount)) }, { label: "Status", render: (c) => h("div", {}, chip(c.status), c.status === "locked" ? h("div", { class: "tiny muted" }, "Waiting for full payment") : null) }, { label: "Released", render: (c) => (c.released_at ? fdate(c.released_at) : "—") }], d.commissions, { emptyTitle: "No commissions yet", emptyText: "A commission is created once an initial payment is verified." }),
    h("h2", { style: { margin: "26px 0 10px" } }, "Payout history"),
    table([{ label: "Date", render: (p) => fdate(p.at) }, { label: "Type", render: (p) => label(p.type) }, { label: "For", render: (p) => p.label || "—" }, { label: "Amount", cls: "mono", render: (p) => money(p.amount) }, { label: "Method / ref", render: (p) => [p.method, p.ref].filter(Boolean).join(" · ") || "—" }], d.payouts, { emptyTitle: "No payouts yet" }),
    d.bonuses.length ? [h("h2", { style: { margin: "26px 0 10px" } }, "Bonuses"), table([{ label: "Date", render: (b) => fdate(b.created_at) }, { label: "Reason", render: (b) => b.reason }, { label: "Amount", cls: "mono", render: (b) => money(b.amount) }, { label: "Status", render: (b) => chip(b.status) }], d.bonuses)] : null);
}

// ================= NOTIFICATIONS =================
export async function notificationsView(el, ctx) {
  const [{ notifications }, { announcements }] = await Promise.all([GET("/api/notifications"), GET("/api/announcements")]);
  const list = h("div", { class: "card", style: { padding: 0 } });
  const draw = () => { clear(list); if (!notifications.length) return list.appendChild(empty("No notifications", "Task assignments, approvals and announcements appear here.", "bell"));
    notifications.forEach((n) => list.appendChild(h("div", { class: "task", style: { cursor: n.link ? "pointer" : "default" }, onclick: async () => { if (!n.read_at) { await POST("/api/notifications/read", { ids: [n.id] }); n.read_at = new Date().toISOString(); ctx.refreshBadge(); } if (n.link) location.hash = n.link; else draw(); } },
      h("span", { class: "dot", style: { position: "static", background: n.read_at ? "transparent" : "var(--accent)", minWidth: "10px", height: "10px", marginTop: "6px" } }), h("div", { class: "grow" }, h("div", { style: { fontWeight: n.read_at ? 500 : 650 } }, n.title), n.body ? h("div", { class: "muted small" }, n.body) : null, h("div", { class: "muted tiny" }, ago(n.created_at)))))); };
  draw();
  el.append(pageHead("Notifications", "Updates, reminders and announcements", h("button", { class: "btn sm", onclick: async () => { await POST("/api/notifications/read", { all: true }); notifications.forEach((n) => (n.read_at ||= new Date().toISOString())); draw(); ctx.refreshBadge(); toast("All marked as read"); } }, "Mark all read"),
    "Notification" in window && Notification.permission !== "granted" ? h("button", { class: "btn sm", onclick: async () => { await enableBrowserNotifications(); ctx.reload(); } }, icon("bell", 15), "Enable browser alerts") : null),
    announcements.length ? h("div", { style: { marginBottom: "18px" } }, h("h2", { style: { marginBottom: "10px" } }, "Announcements"), announcements.slice(0, 5).map((a) => h("div", { class: "card", style: { marginBottom: "10px" } }, h("div", { class: "row sp" }, h("b", {}, a.title), h("span", { class: "muted small" }, fdate(a.created_at))), h("p", { class: "preview-box", style: { margin: "6px 0" } }, a.body), h("div", { class: "muted tiny" }, "From " + a.author)))) : null,
    h("h2", { style: { marginBottom: "10px" } }, "Activity"), list);
}

// ================= PROFILE & SECURITY =================
export async function profileView(el, ctx) {
  const u = ctx.user; const [{ sessions, current }, { events }] = await Promise.all([GET("/api/auth/sessions"), GET("/api/auth/history")]);
  const picker = h("input", { type: "file", accept: "image/*", class: "hide", onchange: async (e) => { try { const id = await upload(e.target.files[0], "avatar"); await POST("/api/auth/avatar", { file_id: id }); toast("Profile picture updated"); location.reload(); } catch (x) { fail(x); } } });
  const pwForm = () => formModal({ title: "Change password", fields: [{ name: "current", label: "Current password", type: "password", required: true, autocomplete: "current-password" }, { name: "next", label: "New password", type: "password", required: true, autocomplete: "new-password", help: "At least 10 characters with letters and numbers." }, { name: "again", label: "Confirm new password", type: "password", required: true, autocomplete: "new-password" }],
    onSubmit: async (v) => { if (v.next !== v.again) throw new Error("Passwords do not match"); await POST("/api/auth/change-password", { current: v.current, next: v.next }); toast("Password changed. Other devices were signed out."); } });
  async function setup2fa() {
    const s = await POST("/api/auth/2fa/setup");
    await formModal({ title: "Set up two-factor authentication", submitText: "Enable", intro: "Add this key to an authenticator app (Google Authenticator, 1Password, Authy…), then enter the 6-digit code.",
      fields: [{ name: "secret", label: "Setup key", value: s.secret }, { name: "code", label: "6-digit code", required: true, inputmode: "numeric", max: 6 }],
      onSubmit: async (v) => { const r = await POST("/api/auth/2fa/enable", { code: v.code }); setTimeout(() => modal({ title: "Save your recovery codes", body: h("div", { class: "col" }, h("p", { class: "muted" }, "Each code works once if you lose your authenticator. They will not be shown again."), h("pre", { class: "code" }, r.recovery_codes.join("\n"))), actions: [h("button", { class: "btn primary", onclick: () => location.reload() }, "I saved them")], onClose: () => location.reload() }), 250); } });
  }
  el.append(pageHead("Profile", "Your account and security"),
    h("div", { class: "grid g2" },
      h("div", { class: "card" }, h("div", { class: "row", style: { marginBottom: "14px" } }, avatar(u, "lg"), h("div", {}, h("h2", {}, u.full_name), h("div", { class: "muted" }, u.position || "Staff"), h("button", { class: "btn sm", style: { marginTop: "8px" }, onclick: () => picker.click() }, icon("upload", 14), "Change picture"), picker)),
        detailRows([["Staff ID", u.staff_code], ["Username", u.username], ["Date joined", fdate(u.joined_at)], ["Last login", fdt(u.last_login_at)], ["Responsibilities", u.responsibilities || "Not assigned yet"]])),
      h("div", { class: "card" }, h("h3", {}, "Security"), h("div", { class: "col" }, h("div", { class: "row sp" }, h("div", {}, h("b", {}, "Password"), h("div", { class: "muted small" }, "Change it regularly")), h("button", { class: "btn sm", onclick: () => pwForm() }, "Change")),
        h("div", { class: "row sp" }, h("div", {}, h("b", {}, "Two-factor authentication"), h("div", { class: "muted small" }, u.totp_enabled ? "Enabled" : "Optional extra protection")), u.totp_enabled ? h("button", { class: "btn sm danger", onclick: () => formModal({ title: "Disable two-factor", submitText: "Disable", fields: [{ name: "password", label: "Confirm your password", type: "password", required: true }], onSubmit: async (v) => { await POST("/api/auth/2fa/disable", v); location.reload(); } }) }, "Disable") : h("button", { class: "btn sm", onclick: () => setup2fa().catch(fail) }, "Set up")),
        h("div", { class: "row sp" }, h("div", {}, h("b", {}, "Appearance")), h("button", { class: "btn sm", onclick: () => toggleTheme() }, "Switch light / dark")),
        h("div", { class: "row sp" }, h("div", {}, h("b", {}, "Browser notifications"), h("div", { class: "muted small" }, "Permission: " + ("Notification" in window ? Notification.permission : "unsupported"))), h("button", { class: "btn sm", onclick: async () => { await enableBrowserNotifications(); ctx.reload(); } }, "Enable"))))),
    h("div", { class: "row sp", style: { margin: "24px 0 10px" } }, h("h2", {}, "Signed-in devices"), sessions.length > 1 ? h("button", { class: "btn sm", onclick: async () => { await POST("/api/auth/sessions/revoke-others"); toast("Other devices signed out"); ctx.reload(); } }, "Sign out other devices") : null),
    table([{ label: "Device", render: (s) => (s.user_agent || "Unknown").slice(0, 70) + (s.id === current ? " (this device)" : "") }, { label: "IP", render: (s) => s.ip }, { label: "Signed in", render: (s) => fdt(s.created_at) }, { label: "Last active", render: (s) => ago(s.last_seen) }, { label: "", act: true, render: (s) => (s.id === current ? null : h("button", { class: "btn sm danger", onclick: async () => { await DEL("/api/auth/sessions/" + s.id); ctx.reload(); } }, "Sign out")) }], sessions),
    h("h2", { style: { margin: "24px 0 10px" } }, "Recent sign-in activity"),
    table([{ label: "When", render: (e) => fdt(e.created_at) }, { label: "Result", render: (e) => chip(e.success ? "verified" : "rejected", e.success ? "Success" : "Failed") }, { label: "IP", render: (e) => e.ip }, { label: "Device", render: (e) => (e.user_agent || "").slice(0, 60) }], events));
}
