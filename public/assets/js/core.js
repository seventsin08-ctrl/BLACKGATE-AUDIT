// BlackGate shared UI toolkit. All dynamic content is inserted as text nodes (never innerHTML).
const ICONS = {
  home: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10",
  tasks: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  notes: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
  plus: "M12 5v14M5 12h14", bell: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0",
  money: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  clip: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 2h6v4H9z",
  chart: "M12 20V10M18 20V4M6 20v-4", sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  menu: "M3 12h18M3 6h18M3 18h18", more: "M5 12h.01M12 12h.01M19 12h.01", out: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.35-4.35", x: "M18 6L6 18M6 6l12 12",
  edit: "M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z", trash: "M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42",
  moon: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z", shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3", msg: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  award: "M12 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14M8.21 13.89L7 23l5-3 5 3-1.21-9.12", cal: "M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM16 2v4M8 2v4M3 10h18",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2", db: "M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3zM21 12c0 1.66-4.03 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5",
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3", card: "M3 4h18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM1 10h22",
  gift: "M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z",
  brief: "M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16",
  chevd: "M6 9l6 6 6-6", chevu: "M18 15l-6-6-6 6", chevr: "M9 6l6 6-6 6", pin: "M12 17v5M9 10.76V6a3 3 0 0 1 6 0v4.76a2 2 0 0 0 1.11 1.79L17 14H7l.89-1.45A2 2 0 0 0 9 10.76z",
  archive: "M21 8v13H3V8M1 3h22v5H1zM10 12h4", folder: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
  lock: "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4", check: "M20 6L9 17l-5-5",
  back: "M19 12H5M12 19l-7-7 7-7", link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12", mega: "M3 11l18-8v18L3 13zM11.6 16.8a3 3 0 1 1-5.8-1.6", up: "M12 19V5M5 12l7-7 7 7",
};
export function icon(name, size = 20) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", size); s.setAttribute("height", size);
  s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "1.9");
  s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", ICONS[name] || ICONS.more); s.appendChild(p);
  return s;
}

// Element.append / DocumentFragment.append: flatten arrays and ignore null/false so conditional children never render as text.
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  const native = proto.append;
  proto.append = function (...kids) { native.apply(this, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false)); };
}
export const $ = (s, r = document) => r.querySelector(s);
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value") el.value = v;
    else if (k === "checked" || k === "selected" || k === "disabled") el[k] = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) return c.forEach(add);
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// ---------- formatting (Philippine time) ----------
const TZ = "Asia/Manila";
export const phToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
export const addDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const money = (v) => "₱" + Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fdate = (d) => (d ? new Date(String(d).length === 10 ? d + "T00:00:00+08:00" : d).toLocaleDateString("en-PH", { timeZone: TZ, year: "numeric", month: "short", day: "numeric" }) : "—");
export const fdt = (d) => (d ? new Date(d).toLocaleString("en-PH", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
export const ftime = (d) => new Date(d).toLocaleTimeString("en-PH", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
export function ago(d) {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
export const toLocalInput = (d) => (d ? new Date(new Date(d).getTime() + 8 * 3600e3).toISOString().slice(0, 16) : "");
export const fromLocalInput = (v) => (v ? new Date(v + ":00+08:00").toISOString() : null);
export const initials = (n) => (n || "?").split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase();

const TONES = { verified: "ok", approved: "ok", completed: "ok", released: "ok", active: "ok", eligible: "info", submitted: "info", under_review: "info", in_progress: "info", awarded: "info",
  pending: "warn", locked: "warn", correction_requested: "warn", draft: "", not_started: "", overdue: "bad", rejected: "bad", duplicate: "bad", cancelled: "", void: "", suspended: "bad" };
export const label = (s) => String(s || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
export const chip = (s, text) => h("span", { class: "chip " + (TONES[s] ?? "") }, text || label(s));

// ---------- API ----------
export class ApiError extends Error { constructor(m, status, data) { super(m); this.status = status; this.data = data; } }
export async function api(method, path, body) {
  const opts = { method, headers: { "x-requested-with": "bg" }, credentials: "same-origin" };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, opts); } catch { throw new ApiError("You appear to be offline. Check your connection and try again.", 0); }
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json().catch(() => ({})) : null;
  if (res.status === 401 && !path.includes("/auth/login") && !path.includes("/auth/register") && location.pathname !== "/") { location.href = location.pathname.startsWith("/admin") ? "/admin/?expired=1" : "/?expired=1"; throw new ApiError("Session expired", 401); }
  if (res.status === 403 && data?.code === "must_change_password" && location.pathname !== "/") { location.href = location.pathname.startsWith("/admin") ? "/admin/" : "/"; throw new ApiError("Password change required", 403); }
  if (!res.ok) throw new ApiError(data?.error || "Something went wrong", res.status, data);
  return data ?? res;
}
export const GET = (p, q) => api("GET", p + (q ? "?" + new URLSearchParams(Object.entries(q).filter(([, v]) => v !== "" && v !== undefined && v !== null)) : ""));
export const POST = (p, b = {}) => api("POST", p, b);
export const PUT = (p, b) => api("PUT", p, b);
export const PATCH = (p, b) => api("PATCH", p, b);
export const DEL = (p) => api("DELETE", p);
export async function download(path, q, name) {
  const res = await fetch(path + "?" + new URLSearchParams({ ...q, format: "csv" }), { headers: { "x-requested-with": "bg" }, credentials: "same-origin" });
  if (!res.ok) throw new ApiError((await res.json().catch(() => ({}))).error || "Export failed", res.status);
  const a = h("a", { href: URL.createObjectURL(await res.blob()), download: name }); document.body.appendChild(a); a.click(); a.remove();
}
export async function compressImage(file, max = 1600) {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.size < 600 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file); const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch { return file; }
}
export async function upload(file, kind) {
  if (!file) return null;
  const f = await compressImage(file); const fd = new FormData(); fd.set("kind", kind); fd.set("file", f);
  return (await api("POST", "/api/files", fd)).id;
}
export const fileUrl = (id) => "/api/files/" + id;
export function fileLink(id, text = "View file") { return id ? h("a", { href: fileUrl(id), target: "_blank", rel: "noopener" }, icon("link", 14), " ", text) : null; }

// ---------- UI feedback ----------
let toastBox;
export function toast(msg, bad = false) {
  if (!toastBox) { toastBox = h("div", { class: "toasts", role: "status", "aria-live": "polite" }); document.body.appendChild(toastBox); }
  const t = h("div", { class: "toast" + (bad ? " bad" : "") }, msg); toastBox.appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 220); }, bad ? 4500 : 2600);
}
export const fail = (e) => toast(e?.message || "Something went wrong", true);
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const close = (v) => { ov.remove(); document.removeEventListener("keydown", esc); onClose?.(v); };
  const esc = (e) => { if (e.key === "Escape") close(null); };
  const box = h("div", { class: "modal" + (wide ? " wide" : ""), role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "modal-h" }, h("h2", {}, title), h("button", { class: "icon-btn", "aria-label": "Close", onclick: () => close(null) }, icon("x"))),
    h("div", { class: "modal-b" }, body), actions.length ? h("div", { class: "modal-f" }, actions) : null);
  const ov = h("div", { class: "ov", onmousedown: (e) => { if (e.target === ov) close(null); } }, box);
  document.body.appendChild(ov); document.addEventListener("keydown", esc);
  setTimeout(() => box.querySelector("input:not([type=hidden]),textarea,select")?.focus(), 60);
  return { close, box };
}
export function confirmDialog({ title = "Are you sure?", message, confirmText = "Confirm", danger = false }) {
  return new Promise((res) => {
    let done = false; const fin = (v) => { if (!done) { done = true; res(v); } };
    const m = modal({ title, body: h("p", { class: "muted" }, message), onClose: () => fin(false),
      actions: [h("button", { class: "btn", onclick: () => m.close(false) }, "Cancel"), h("button", { class: "btn primary" + (danger ? " danger solid" : ""), onclick: () => { fin(true); m.close(true); } }, confirmText)] });
  });
}
/** fields: {name,label,type,options,required,value,help,placeholder,rows,two} */
export function formModal({ title, fields, submitText = "Save", onSubmit, wide = false, intro }) {
  return new Promise((resolve) => {
    const err = h("div", { class: "err", role: "alert" }); let busy = false;
    const inputs = {};
    const mk = (f) => {
      let inp;
      if (f.type === "textarea") inp = h("textarea", { rows: f.rows || 3, placeholder: f.placeholder || "", maxlength: f.max }, f.value || "");
      else if (f.type === "select") inp = h("select", {}, (f.options || []).map((o) => h("option", { value: o.value ?? o, selected: String(o.value ?? o) === String(f.value ?? "") }, o.label ?? o)));
      else if (f.type === "checkbox") inp = h("input", { type: "checkbox", checked: !!f.value });
      else if (f.type === "multi") {
        const boxes = (f.options || []).map((o) => ({ o, el: h("input", { type: "checkbox", checked: (f.value || []).includes(o.value) }) }));
        inp = h("div", { class: "col", style: { gap: "6px", maxHeight: "190px", overflow: "auto" } }, boxes.map((b) => h("label", { class: "chk" }, b.el, b.o.label)));
        inp.getValue = () => boxes.filter((b) => b.el.checked).map((b) => b.o.value);
      } else inp = h("input", { type: f.type || "text", value: f.value ?? "", placeholder: f.placeholder || "", maxlength: f.max, min: f.min, max: f.maxv, step: f.step, accept: f.accept, autocomplete: f.autocomplete || "off", inputmode: f.inputmode });
      if (f.required && f.type !== "multi") inp.required = true;
      inputs[f.name] = inp;
      if (f.type === "checkbox") return h("label", { class: "chk" }, inp, f.label);
      return h("label", { class: "f" }, f.label + (f.required ? " *" : ""), inp, f.help ? h("span", { class: "help" }, f.help) : null);
    };
    const formEl = h("form", { class: "form", novalidate: true }, intro ? h("p", { class: "muted small" }, intro) : null, fields.map(mk), err);
    const read = () => {
      const v = {};
      for (const f of fields) {
        const i = inputs[f.name];
        v[f.name] = f.type === "checkbox" ? i.checked : f.type === "multi" ? i.getValue() : f.type === "file" ? i.files[0] || null : f.type === "datetime-local" ? fromLocalInput(i.value) : i.value;
      }
      return v;
    };
    const save = async () => {
      if (busy) return;
      for (const f of fields) if (f.required && f.type !== "checkbox" && f.type !== "multi" && !(f.type === "file" ? inputs[f.name].files[0] : inputs[f.name].value.trim())) { err.textContent = `${f.label} is required`; inputs[f.name].focus(); return; }
      busy = true; okBtn.disabled = true; err.textContent = "";
      try { await onSubmit(read()); m.close(true); resolve(true); } catch (e) { err.textContent = e.message || "Could not save"; busy = false; okBtn.disabled = false; }
    };
    formEl.addEventListener("submit", (e) => { e.preventDefault(); save(); });
    const okBtn = h("button", { class: "btn primary", onclick: save }, submitText);
    const m = modal({ title, wide, body: formEl, onClose: (v) => { if (v !== true) resolve(false); }, actions: [h("button", { class: "btn", onclick: () => m.close(null) }, "Cancel"), okBtn] });
  });
}
export const textareaLines = (s) => String(s || "").split("\n").map((t) => t.trim()).filter(Boolean).map((text) => ({ text, done: false }));

// ---------- components ----------
export function skeleton(kind = "page") {
  if (kind === "table") return h("div", { class: "col" }, [1, 2, 3, 4, 5].map(() => h("div", { class: "sk", style: { height: "44px" } })));
  return h("div", { class: "col" }, h("div", { class: "sk", style: { width: "40%", height: "28px" } }),
    h("div", { class: "grid g4" }, [1, 2, 3, 4].map(() => h("div", { class: "sk b" }))), h("div", { class: "sk b", style: { height: "220px" } }));
}
export function empty(title, text, ic = "clip") { return h("div", { class: "empty" }, icon(ic, 34), h("b", {}, title), text ? h("div", {}, text) : null); }
export function table(cols, rows, { emptyTitle = "Nothing here yet", emptyText = "", onRow } = {}) {
  if (!rows.length) return h("div", { class: "card" }, empty(emptyTitle, emptyText));
  return h("div", { class: "tw" }, h("table", { class: "tbl" },
    h("thead", {}, h("tr", {}, cols.map((c) => h("th", { class: c.cls || "" }, c.label)))),
    h("tbody", {}, rows.map((r) => h("tr", { class: onRow ? "click" : "", onclick: onRow ? (e) => { if (!e.target.closest("button,a,input,select")) onRow(r); } : null },
      cols.map((c) => h("td", { "data-label": c.label, class: (c.cls || "") + (c.act ? " act" : "") }, c.render ? c.render(r) : (r[c.key] ?? "—")))))))
  );
}
export function stat(labelText, value, sub, { money: m, dark, i = 0 } = {}) {
  const v = h("div", { class: "v mono" }, m ? money(0) : "0");
  const el = h("div", { class: "card stat" + (m ? " money" : "") + (dark ? " fin" : ""), style: { "--i": i } }, h("div", { class: "l" }, labelText), v, sub ? h("div", { class: "s" }, sub) : null);
  countUp(v, Number(value) || 0, m);
  return el;
}
export function countUp(el, to, isMoney) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmt = (n) => (isMoney ? money(n) : Math.round(n).toLocaleString("en-PH"));
  if (reduce || to === 0) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), d = 450;
  const step = (t) => { const k = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(to * e); if (k < 1) requestAnimationFrame(step); else el.textContent = fmt(to); };
  requestAnimationFrame(step);
}
export function avatar(user, cls = "") {
  const a = h("div", { class: "avatar " + cls });
  if (user?.avatar_file) { const img = h("img", { src: fileUrl(user.avatar_file), alt: "", loading: "lazy" }); img.onerror = () => { img.remove(); a.textContent = initials(user.full_name || user.name); }; a.appendChild(img); }
  else a.textContent = initials(user?.full_name || user?.name);
  return a;
}
export function seg(options, value, onChange) {
  const wrap = h("div", { class: "seg", role: "tablist" });
  const draw = (val) => { clear(wrap); options.forEach((o) => wrap.appendChild(h("button", { class: o.value === val ? "on" : "", role: "tab", "aria-selected": o.value === val, onclick: () => { draw(o.value); onChange(o.value); } }, o.label))); };
  draw(value); return wrap;
}
/** Period bar → {el, get()}; calls onChange({from,to}) */
export function rangeBar(onChange, def = "30d") {
  const today = phToday(), mon = (d) => { const x = new Date(d + "T00:00:00Z"); const k = (x.getUTCDay() + 6) % 7; return addDays(d, -k); };
  const presets = { today: () => [today, today], week: () => [mon(today), today], month: () => [today.slice(0, 8) + "01", today], "30d": () => [addDays(today, -29), today] };
  let from = presets[def]()[0], to = today;
  const f = h("input", { type: "date", value: from, "aria-label": "From" }), t = h("input", { type: "date", value: to, "aria-label": "To" });
  const custom = h("div", { class: "row hide" }, f, t);
  const s = seg([{ value: "today", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "30d", label: "30 days" }, { value: "custom", label: "Custom" }], def, (v) => {
    custom.classList.toggle("hide", v !== "custom");
    if (v !== "custom") { [from, to] = presets[v](); f.value = from; t.value = to; onChange({ from, to }); }
  });
  const go = () => { if (f.value && t.value && f.value <= t.value) { from = f.value; to = t.value; onChange({ from, to }); } else toast("Choose a valid date range", true); };
  f.onchange = go; t.onchange = go;
  return { el: h("div", { class: "row" }, s, custom), get: () => ({ from, to }) };
}
export function pageHead(title, sub, ...actions) { return h("div", { class: "page-head" }, h("div", {}, h("h1", {}, title), sub ? h("p", {}, sub) : null), h("div", { class: "row" }, actions)); }
export function collapsible(title, content, { open = true, i = 0 } = {}) {
  const body = h("div", { class: "body" }, content);
  const c = h("div", { class: "card collapsible" + (open ? "" : " closed"), style: { "--i": i } },
    h("div", { class: "card-h", onclick: () => { c.classList.toggle("closed"); body.style.maxHeight = c.classList.contains("closed") ? "0" : body.scrollHeight + "px"; } }, h("h3", {}, title), h("span", { class: "chev" }, icon("chevd", 18))), body);
  body.style.maxHeight = open ? "2000px" : "0"; return c;
}
export function detailRows(pairs) { return h("div", { class: "col", style: { gap: "8px" } }, pairs.filter(Boolean).map(([k, v]) => h("div", { class: "row sp", style: { flexWrap: "nowrap", alignItems: "flex-start" } }, h("span", { class: "muted small" }, k), h("span", { style: { textAlign: "right", minWidth: 0, wordBreak: "break-word" } }, v ?? "—")))); }
export function barChart(series, key, key2) {
  const max = Math.max(1, ...series.map((s) => s[key]));
  return h("div", { class: "chart", role: "img", "aria-label": "Trend chart" }, series.map((s) => h("i", { class: key2 ? "" : "", title: `${fdate(s.date)}: ${s[key]}`, style: { height: Math.max(3, (s[key] / max) * 100) + "%" } })));
}

// ---------- theme ----------
export function initTheme() {
  let t = null; try { t = localStorage.getItem("bg-theme"); } catch {}
  if (!t) t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = t;
}
export function toggleTheme() {
  const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = t; try { localStorage.setItem("bg-theme", t); } catch {}
  return t;
}

// ---------- app shell + router ----------
export async function startApp({ role, nav, mobile, routes, title, onLoggedOut }) {
  initTheme();
  const loggedOut = (u) => (onLoggedOut ? onLoggedOut(u) : (location.href = role === "superadmin" ? "/admin/" : "/"));
  let me;
  try {
    const r = await fetch("/api/auth/me", { credentials: "same-origin", headers: { "x-requested-with": "bg" } });
    if (!r.ok) return loggedOut(null);
    me = await r.json();
  } catch { return loggedOut(null); }
  if (me.user.must_change_password) return loggedOut(me.user);
  if (me.user.role !== role) { if (role === "staff") { location.href = "/admin/"; return; } return loggedOut(null); }
  const user = me.user, ctx = { user, today: me.today, settings: me.settings, refreshBadge: () => {} };
  const root = $("#root"); clear(root);
  let collapsed = false; try { collapsed = localStorage.getItem("bg-collapsed") === "1"; } catch {}
  const view = h("main", { class: "content", id: "view", tabindex: "-1" });
  const heading = h("h1", {}, title);
  const bellDot = h("span", { class: "dot hide" }, "0");
  const themeBtn = h("button", { class: "icon-btn", "aria-label": "Toggle theme", onclick: () => { themeBtn.replaceChildren(icon(toggleTheme() === "dark" ? "sun" : "moon")); } }, icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon"));
  const clock = h("span", { class: "muted small desk mono" });
  const tick = () => { clock.textContent = new Date().toLocaleString("en-PH", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PH"; };
  tick(); setInterval(tick, 20000);
  const navBtns = {};
  const go = (id) => { location.hash = "#/" + id; };
  const navInd = h("div", { class: "nav-ind" });
  const navList = h("nav", { class: "navlist", "aria-label": "Main" }, navInd, nav.map((n) => {
    const b = h("button", { class: "nav-item", onclick: () => go(n.id), "aria-label": n.label }, icon(n.icon), h("span", {}, n.label)); navBtns[n.id] = b; return b;
  }));
  const side = h("aside", { class: "side" }, h("div", { class: "brand" }, h("div", { class: "logo" }, "BG"), h("span", {}, "BlackGate")), navList,
    h("div", { class: "side-foot" }, h("button", { class: "nav-item", onclick: () => logout() }, icon("out"), h("span", {}, "Sign out"))));
  const shell = h("div", { class: "shell" + (collapsed ? " collapsed" : "") });
  const bnInd = h("div", { class: "bn-ind" });
  const bnBtns = {};
  const bn = h("nav", { class: "bn", "aria-label": "Primary" }, h("div", { class: "bn-in" }, bnInd, mobile.map((id) => {
    const n = id === "more" ? { id: "more", label: "More", icon: "more" } : nav.find((x) => x.id === id);
    const b = h("button", { onclick: () => (id === "more" ? moreSheet() : go(id)), "aria-label": n.label }, icon(n.icon, 22), n.short || n.label); bnBtns[id] = b; return b;
  })));
  function moreSheet() {
    const m = modal({ title: "Menu", body: h("div", { class: "sheet-nav" }, nav.filter((n) => !mobile.includes(n.id)).map((n) => h("button", { class: "nav-item", style: { height: "46px" }, onclick: () => { m.close(); go(n.id); } }, icon(n.icon), h("span", {}, n.label))),
      h("button", { class: "nav-item", style: { height: "46px" }, onclick: () => { m.close(); toggleTheme(); } }, icon("moon"), h("span", {}, "Switch theme")),
      h("button", { class: "nav-item", style: { height: "46px" }, onclick: () => logout() }, icon("out"), h("span", {}, "Sign out"))) });
  }
  async function logout() { try { await POST("/api/auth/logout"); } catch {} location.href = role === "superadmin" ? "/admin/" : "/"; }
  const top = h("header", { class: "top" },
    h("button", { class: "icon-btn desk", "aria-label": "Collapse sidebar", onclick: () => { shell.classList.toggle("collapsed"); try { localStorage.setItem("bg-collapsed", shell.classList.contains("collapsed") ? "1" : "0"); } catch {} setTimeout(moveInd, 280); } }, icon("menu")),
    heading, h("div", { class: "grow" }), clock, themeBtn,
    h("button", { class: "icon-btn", "aria-label": "Notifications", onclick: () => go("notifications") }, icon("bell"), bellDot),
    h("button", { class: "icon-btn", "aria-label": "Account", onclick: () => go(role === "staff" ? "profile" : "settings") }, avatar(user, "sm")));
  shell.append(side, h("div", { class: "main" }, top, view)); root.append(shell, bn);

  function moveInd() {
    const id = current; const b = navBtns[id];
    if (b && navList.offsetParent) { navInd.style.transform = `translateY(${b.offsetTop}px)`; navInd.style.height = b.offsetHeight + "px"; navInd.style.opacity = 1; } else navInd.style.opacity = 0;
    const m = bnBtns[id] || bnBtns.more;
    if (m && bn.offsetParent) { bnInd.style.width = m.offsetWidth * 0.5 + "px"; bnInd.style.transform = `translateX(${m.offsetLeft + m.offsetWidth * 0.25}px)`; }
  }
  let current = null, token = 0, cleanup = null;
  async function route() {
    const parts = (location.hash.replace(/^#\/?/, "") || routes.default).split("/"); const id = parts[0];
    const def = routes[id] ? id : routes.default; const r = routes[def];
    const my = ++token; current = def; cleanup?.(); cleanup = null;
    Object.entries(navBtns).forEach(([k, b]) => { b.classList.toggle("active", k === def); b.setAttribute("aria-current", k === def ? "page" : "false"); });
    Object.entries(bnBtns).forEach(([k, b]) => b.classList.toggle("active", k === def || (k === "more" && !mobile.includes(def))));
    heading.textContent = r.title; document.title = r.title + " · BlackGate"; moveInd();
    clear(view).appendChild(skeleton());
    try {
      const page = h("div", { class: "page" }); const out = await r.render(page, { ...ctx, param: parts[1], rest: parts.slice(1) });
      if (my !== token) return; clear(view).appendChild(page); cleanup = out?.cleanup || null; scrollTo(0, 0);
    } catch (e) { if (my === token) { clear(view).appendChild(h("div", { class: "card" }, empty("Could not load this page", e.message, "x"), h("div", { class: "row", style: { justifyContent: "center" } }, h("button", { class: "btn", onclick: route }, "Try again")))); } }
  }
  ctx.reload = route;
  addEventListener("hashchange", route); addEventListener("resize", moveInd);

  // notifications: badge + optional browser notifications
  let lastId = null;
  async function pollNotes() {
    try {
      const d = await GET("/api/notifications", { unread: "1" });
      bellDot.textContent = d.unread > 99 ? "99+" : d.unread; bellDot.classList.toggle("hide", !d.unread);
      const newest = d.notifications[0]?.id ?? 0;
      if (lastId !== null && newest > lastId && "Notification" in window && Notification.permission === "granted" && document.hidden !== undefined)
        d.notifications.filter((n) => n.id > lastId).slice(0, 3).forEach((n) => new Notification(n.title, { body: n.body, tag: "bg-" + n.id }));
      lastId = Math.max(lastId ?? 0, newest);
    } catch {}
  }
  ctx.refreshBadge = pollNotes; pollNotes(); setInterval(pollNotes, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pollNotes(); });

  // keyboard shortcuts
  let gPending = false;
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input,textarea,select,[contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/") { const s = $("#view input[type=search]"); if (s) { e.preventDefault(); s.focus(); } }
    else if (e.key === "g") { gPending = true; setTimeout(() => (gPending = false), 900); }
    else if (e.key === "?") shortcutsHelp(nav);
    else if (gPending) { const n = nav.find((x) => x.key === e.key); if (n) go(n.id); gPending = false; }
  });
  if (!location.hash) location.hash = "#/" + routes.default; else route();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  return ctx;
}
function shortcutsHelp(nav) {
  modal({ title: "Keyboard shortcuts", body: h("div", { class: "col" }, h("div", { class: "row sp" }, h("span", {}, "Search on page"), h("span", { class: "kbd" }, "/")),
    nav.filter((n) => n.key).map((n) => h("div", { class: "row sp" }, h("span", {}, "Go to " + n.label), h("span", {}, h("span", { class: "kbd" }, "g"), " ", h("span", { class: "kbd" }, n.key)))),
    h("div", { class: "row sp" }, h("span", {}, "This help"), h("span", { class: "kbd" }, "?"))) });
}
export async function enableBrowserNotifications() {
  if (!("Notification" in window)) return toast("Browser notifications are not supported on this device", true);
  const p = await Notification.requestPermission(); toast(p === "granted" ? "Browser notifications enabled" : "Notifications were not allowed");
  return p;
}
