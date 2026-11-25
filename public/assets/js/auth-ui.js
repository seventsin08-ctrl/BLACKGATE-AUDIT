// Sign-in / create-account / forced password change. Two separate portals: "staff" (/) and "admin" (/admin/).
import { h, $, clear, POST, GET, initTheme } from "./core.js";

export async function mountAuth(root, { portal, user = null, expired = false }) {
  initTheme();
  const isAdmin = portal === "admin";
  const home = isAdmin ? "/admin/" : "/app/";
  const shell = (...kids) => clear(root).appendChild(h("div", { class: "login" }, h("div", { class: "card" }, h("div", { class: "logo" }, isAdmin ? "BG" : "BG"), ...kids)));
  const link = (text, fn) => h("button", { class: "btn ghost block", type: "button", onclick: fn }, text);

  function signIn(msg = "") {
    const err = h("div", { class: "err", role: "alert" }, msg), otp = h("input", { autocomplete: "one-time-code", inputmode: "numeric", maxlength: 12 });
    const otpWrap = h("label", { class: "f hide" }, "Verification code or recovery code", otp);
    const u = h("input", { autocomplete: "username", autocapitalize: "none", autocorrect: "off", required: true }), p = h("input", { type: "password", autocomplete: "current-password", required: true });
    const btn = h("button", { class: "btn primary block", type: "submit" }, "Sign in");
    const form = h("form", { class: "form", onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ""; btn.disabled = true;
      try {
        const r = await POST("/api/auth/login", { username: u.value, password: p.value, otp: otp.value, portal });
        if (r.needs_otp) { otpWrap.classList.remove("hide"); otp.focus(); err.textContent = "Enter your verification code."; }
        else if (r.user.must_change_password) changePw(r.user, p.value); else location.href = home;
      } catch (x) { err.textContent = x.message; } finally { btn.disabled = false; }
    } }, h("label", { class: "f" }, "Username", u), h("label", { class: "f" }, "Password", p), otpWrap, err, btn);
    shell(isAdmin ? h("span", { class: "chip", style: { marginBottom: "10px" } }, "Administrator") : null, h("h1", {}, isAdmin ? "Control Center" : "BlackGate"),
      h("p", { class: "muted", style: { margin: "4px 0 20px" } }, isAdmin ? "Administrator sign-in" : "Sign in to your workspace"), form,
      isAdmin ? h("p", { class: "tiny muted", style: { marginTop: "16px" } }, "This page is for the administrator only. Staff sign in at the main page.") : [
        signupMode !== "closed" ? link("Create a staff account", () => signUp()) : null,
        h("p", { class: "tiny muted", style: { marginTop: "12px" } }, "Forgot your password? Ask the administrator to reset it.")]);
    u.focus();
  }

  function signUp() {
    const f = { name: h("input", { autocomplete: "name", required: true, maxlength: 120 }), user: h("input", { autocomplete: "username", autocapitalize: "none", required: true, maxlength: 40 }), pos: h("input", { maxlength: 120, placeholder: "Optional" }),
      p1: h("input", { type: "password", autocomplete: "new-password", required: true }), p2: h("input", { type: "password", autocomplete: "new-password", required: true }) };
    const err = h("div", { class: "err", role: "alert" }), btn = h("button", { class: "btn primary block", type: "submit" }, "Create account");
    shell(h("h1", {}, "Create your account"), h("p", { class: "muted", style: { margin: "4px 0 18px" } }, signupMode === "approval" ? "New accounts must be approved by the administrator before you can sign in." : "Set up your own staff workspace."),
      h("form", { class: "form", onsubmit: async (e) => {
        e.preventDefault(); err.textContent = ""; btn.disabled = true;
        try {
          const r = await POST("/api/auth/register", { full_name: f.name.value, username: f.user.value, position: f.pos.value, password: f.p1.value, confirm: f.p2.value });
          if (r.pending) shell(h("h1", {}, "Account created"), h("p", { class: "muted", style: { margin: "8px 0 18px" } }, "The administrator needs to approve your account. You can sign in once it is approved."), link("Back to sign in", () => signIn()));
          else location.href = "/app/";
        } catch (x) { err.textContent = x.message; btn.disabled = false; }
      } }, h("label", { class: "f" }, "Full name", f.name), h("label", { class: "f" }, "Username", f.user, h("span", { class: "help" }, "Letters, numbers, dot, dash, underscore")), h("label", { class: "f" }, "Position", f.pos),
        h("label", { class: "f" }, "Password", f.p1, h("span", { class: "help" }, "At least 10 characters with letters and numbers.")), h("label", { class: "f" }, "Confirm password", f.p2), err, btn),
      link("I already have an account", () => signIn()));
    f.name.focus();
  }

  function changePw(u, current) {
    const n1 = h("input", { type: "password", autocomplete: "new-password", required: true }), n2 = h("input", { type: "password", autocomplete: "new-password", required: true }), err = h("div", { class: "err", role: "alert" });
    const cur = current ? null : h("input", { type: "password", autocomplete: "current-password", required: true });
    shell(h("h1", {}, "Set a new password"), h("p", { class: "muted", style: { margin: "4px 0 18px" } }, `Welcome, ${u.full_name}. For security you must replace your temporary password before continuing.`),
      h("form", { class: "form", onsubmit: async (e) => {
        e.preventDefault(); err.textContent = "";
        if (n1.value !== n2.value) { err.textContent = "Passwords do not match"; return; }
        try { await POST("/api/auth/change-password", { current: current || cur.value, next: n1.value }); location.href = home; } catch (x) { err.textContent = x.message; }
      } }, cur ? h("label", { class: "f" }, "Current (temporary) password", cur) : null, h("label", { class: "f" }, "New password", n1, h("span", { class: "help" }, "At least 10 characters with letters and numbers.")), h("label", { class: "f" }, "Confirm new password", n2), err,
        h("button", { class: "btn primary block", type: "submit" }, "Save and continue"), link("Cancel", async () => { try { await POST("/api/auth/logout"); } catch {} signIn(); })));
    n1.focus();
  }

  let signupMode = "open";
  try {
    const health = await GET("/api/health");
    if (health.setup !== "ready") { shell(h("h1", {}, "Setup required"), h("p", { class: "muted", style: { marginTop: "8px" } }, health.problem || "The server is not configured yet."), h("p", { class: "tiny muted", style: { marginTop: "12px" } }, "Set the required environment variables in Netlify, then trigger a new deploy. See docs/OPERATIONS.md.")); return; }
    signupMode = (await GET("/api/auth/config")).signup_mode;
  } catch {}
  if (user?.must_change_password) return changePw(user, null);
  signIn(expired ? "Your session expired. Please sign in again." : "");
}
