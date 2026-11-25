import { h, $, clear, api, POST, GET, initTheme, toast, icon } from "./core.js";
initTheme();
const root = $("#root");
const home = (u) => (location.href = u.role === "superadmin" ? "/admin/" : "/app/");

function shell(...kids) { clear(root).appendChild(h("div", { class: "login" }, h("div", { class: "card" }, h("div", { class: "logo" }, "BG"), ...kids))); }

function loginView(msg) {
  const err = h("div", { class: "err", role: "alert" }, msg || ""), otpWrap = h("label", { class: "f hide" }, "Verification code or recovery code", h("input", { id: "otp", autocomplete: "one-time-code", inputmode: "numeric", maxlength: 12 }));
  const u = h("input", { id: "u", autocomplete: "username", autocapitalize: "none", autocorrect: "off", required: true }), p = h("input", { id: "p", type: "password", autocomplete: "current-password", required: true });
  const btn = h("button", { class: "btn primary block", type: "submit" }, "Sign in");
  const form = h("form", { class: "form", onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ""; btn.disabled = true;
    try {
      const r = await POST("/api/auth/login", { username: u.value, password: p.value, otp: otpWrap.querySelector("input").value });
      if (r.needs_otp) { otpWrap.classList.remove("hide"); otpWrap.querySelector("input").focus(); err.textContent = "Enter your verification code."; }
      else if (r.user.must_change_password) changeView(r.user, p.value); else home(r.user);
    } catch (x) { err.textContent = x.message; } finally { btn.disabled = false; }
  } }, h("label", { class: "f" }, "Username", u), h("label", { class: "f" }, "Password", p), otpWrap, err, btn);
  shell(h("h1", {}, "BlackGate"), h("p", { class: "muted", style: { margin: "4px 0 20px" } }, "Sign in to your workspace"), form,
    h("p", { class: "tiny muted", style: { marginTop: "16px" } }, "Accounts are created by the administrator. Forgot your password? Ask the administrator for a reset."));
  u.focus();
}
function changeView(user, current) {
  const n1 = h("input", { type: "password", autocomplete: "new-password", required: true }), n2 = h("input", { type: "password", autocomplete: "new-password", required: true }), err = h("div", { class: "err", role: "alert" });
  const cur = current ? null : h("label", { class: "f" }, "Current (temporary) password", h("input", { type: "password", autocomplete: "current-password", required: true }));
  shell(h("h1", {}, "Set a new password"), h("p", { class: "muted", style: { margin: "4px 0 18px" } }, `Welcome, ${user.full_name}. For security you must replace your temporary password before continuing.`),
    h("form", { class: "form", onsubmit: async (e) => {
      e.preventDefault(); err.textContent = "";
      if (n1.value !== n2.value) { err.textContent = "Passwords do not match"; return; }
      try { await POST("/api/auth/change-password", { current: current || cur.querySelector("input").value, next: n1.value }); toast("Password updated"); home(user); } catch (x) { err.textContent = x.message; }
    } }, cur, h("label", { class: "f" }, "New password", n1, h("span", { class: "help" }, "At least 10 characters with letters and numbers.")), h("label", { class: "f" }, "Confirm new password", n2), err,
      h("button", { class: "btn primary block", type: "submit" }, "Save and continue"), h("button", { class: "btn ghost block", type: "button", onclick: async () => { await POST("/api/auth/logout"); loginView(); } }, "Cancel")));
  n1.focus();
}
(async () => {
  const expired = new URLSearchParams(location.search).get("expired");
  try { const me = await GET("/api/auth/me"); if (me.user.must_change_password) changeView(me.user, null); else home(me.user); }
  catch { 
    try { const hlth = await GET("/api/health"); if (hlth.setup !== "ready") { shell(h("h1", {}, "Setup required"), h("p", { class: "muted", style: { marginTop: "8px" } }, hlth.problem || "The server is not configured yet."), h("p", { class: "tiny muted", style: { marginTop: "12px" } }, "Set the required environment variables in Netlify and redeploy. See docs/OPERATIONS.md.")); return; } } catch {}
    loginView(expired ? "Your session expired. Please sign in again." : "");
  }
})();
