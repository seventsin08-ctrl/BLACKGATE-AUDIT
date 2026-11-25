import { query } from "./db.mjs";

export const DEFAULTS = {
  signup_mode: "open", // open | approval | closed
  commission_percent: 10,
  daily_post_target: 5,
  working_days: [1, 2, 3, 4, 5, 6],
  audit_reminder_hour: 18, // Philippine time
  session_idle_minutes: 120,
  session_max_hours: 12,
  weights: { verified_posts: 20, confirmed_clients: 25, verified_revenue: 25, audit_consistency: 15, task_completion: 15 },
  platform_weights: { verified_posts: 1, confirmed_clients: 5, revenue_per_1000: 1 },
};
export async function getSettings() {
  const rows = await query("SELECT key, value FROM settings");
  const out = structuredClone(DEFAULTS);
  for (const r of rows) out[r.key] = r.value;
  return out;
}
export async function setSetting(key, value) {
  await query(`INSERT INTO settings(key,value,updated_at) VALUES($1,$2::jsonb,now())
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [key, JSON.stringify(value)]);
}
