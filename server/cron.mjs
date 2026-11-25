import { query } from "./db.mjs";
import { getSettings } from "./settings.mjs";
import { notify } from "./services.mjs";
import { createBackup } from "./backup.mjs";
import { phToday } from "./util.mjs";

/** Hourly: deadline reminders, audit reminders, daily backup (02:00 PH), trash purge. */
export async function runScheduled(now = new Date()) {
  const s = await getSettings();
  const phHour = new Date(now.getTime() + 8 * 3600e3).getUTCHours();
  const out = { deadlines: 0, audits: 0, backup: false };

  const due = await query(
    `SELECT id, assigned_to, title FROM tasks WHERE status IN ('not_started','in_progress') AND deadline IS NOT NULL
       AND deadline BETWEEN now() AND now() + interval '24 hours' AND reminded_at IS NULL`);
  for (const t of due) {
    await notify(t.assigned_to, "deadline", "Task due within 24 hours", t.title, "#/tasks");
    await query("UPDATE tasks SET reminded_at=now() WHERE id=$1", [t.id]);
    out.deadlines++;
  }
  if (phHour === s.audit_reminder_hour && s.working_days.includes(new Date(phToday() + "T00:00:00Z").getUTCDay())) {
    const missing = await query(
      `SELECT u.id FROM users u WHERE u.role='staff' AND u.status='active'
         AND NOT EXISTS (SELECT 1 FROM audits a WHERE a.user_id=u.id AND a.audit_date=$1 AND a.status IN ('submitted','approved'))
         AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id=u.id AND n.type='audit_reminder' AND n.created_at::date = now()::date)`, [phToday()]);
    for (const u of missing) { await notify(u.id, "audit_reminder", "Daily audit reminder", "Submit today's audit before you finish.", "#/audit"); out.audits++; }
  }
  if (phHour === 2) { await createBackup("daily", "scheduler"); out.backup = true; }
  await query("DELETE FROM notes WHERE deleted_at < now() - interval '30 days'");
  await query("DELETE FROM sessions WHERE expires_at < now() - interval '7 days' OR revoked AND created_at < now() - interval '7 days'");
  await query("DELETE FROM login_events WHERE created_at < now() - interval '180 days'");
  return out;
}
