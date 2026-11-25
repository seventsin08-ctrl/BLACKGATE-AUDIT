import { $, GET } from "./core.js";
import { mountAuth } from "./auth-ui.js";

(async () => {
  const expired = new URLSearchParams(location.search).get("expired") === "1";
  try {
    const me = await GET("/api/auth/me");
    if (me.user.role === "staff" && !me.user.must_change_password) { location.href = "/app/"; return; }
    if (me.user.role === "staff") return mountAuth($("#root"), { portal: "staff", user: me.user });
  } catch {}
  mountAuth($("#root"), { portal: "staff", expired });
})();
