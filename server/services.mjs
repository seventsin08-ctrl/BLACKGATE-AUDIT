import { query, one } from "./db.mjs";
import { getSettings } from "./settings.mjs";

export async function notify(userId, type, title, body = "", link = "", run = query) {
  await run("INSERT INTO notifications(user_id,type,title,body,link) VALUES($1,$2,$3,$4,$5)", [userId, type, title, body, link]);
}
export async function notifyMany(ids, type, title, body = "", link = "") {
  for (const id of [...new Set(ids)]) await notify(id, type, title, body, link);
}
export async function logActivity(ctx, action, targetType = null, targetId = null, detail = {}) {
  await query(
    "INSERT INTO activity_logs(actor_id,actor_name,action,target_type,target_id,detail,ip) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",
    [ctx?.user?.id ?? null, ctx?.user?.username ?? "system", action, targetType, targetId === null ? null : String(targetId), JSON.stringify(detail), ctx?.ip ?? null]);
}

/**
 * Server-side commission engine.
 * Commission = verified INITIAL payment x rate. Locked until verified payments cover the full price.
 * Approved/released commissions are never silently changed.
 */
export async function recomputeCommission(clientId, run = query) {
  const [client] = await run("SELECT * FROM clients WHERE id=$1", [clientId]);
  if (!client) return null;
  const [sums] = await run(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE kind='initial' AND status='verified'),0)::numeric AS initial_v,
            COALESCE(SUM(amount) FILTER (WHERE status='verified'),0)::numeric AS total_v FROM payments WHERE client_id=$1`, [clientId]);
  const cents = (x) => Math.round(parseFloat(x) * 100);
  const initialC = cents(sums.initial_v), totalC = cents(sums.total_v), priceC = cents(client.price);
  const [existing] = await run("SELECT * FROM commissions WHERE client_id=$1", [clientId]);
  const settings = await getSettings();
  const rate = existing ? parseFloat(existing.rate_percent) : settings.commission_percent;
  if (!existing && initialC === 0) return null;
  if (existing && ["approved", "released"].includes(existing.status)) return existing;
  const amountC = Math.round(initialC * rate / 100);
  const fullyPaid = priceC > 0 && totalC >= priceC;
  let status = fullyPaid ? "eligible" : "locked";
  if (client.status === "cancelled") status = "void";
  const base = (initialC / 100).toFixed(2), amt = (amountC / 100).toFixed(2);
  if (!existing) {
    const [row] = await run(
      `INSERT INTO commissions(client_id,user_id,base_amount,rate_percent,amount,status,eligible_at)
       VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $6='eligible' THEN now() END) RETURNING *`,
      [clientId, client.user_id, base, rate, amt, status]);
    if (status === "eligible") await notify(client.user_id, "commission_eligible", "Commission eligible", `${client.name}: ₱${amt} is ready for approval.`, "#/earnings", run);
    return row;
  }
  const [row] = await run(
    `UPDATE commissions SET base_amount=$2, amount=$3, status=$4,
       eligible_at = CASE WHEN $4='eligible' AND status<>'eligible' THEN now() WHEN $4<>'eligible' THEN NULL ELSE eligible_at END,
       updated_at=now() WHERE client_id=$1 RETURNING *`, [clientId, base, amt, status]);
  if (status === "eligible" && existing.status !== "eligible")
    await notify(client.user_id, "commission_eligible", "Commission eligible", `${client.name}: ₱${amt} is ready for approval.`, "#/earnings", run);
  return row;
}

const PCT = (x) => Math.round(x * 10) / 10;
/** Earnings summary for one staff member (all money computed here, server-side). */
export async function earningsFor(userId) {
  const [c] = await query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE status='locked'),0) AS locked,
            COALESCE(SUM(amount) FILTER (WHERE status='eligible'),0) AS eligible,
            COALESCE(SUM(amount) FILTER (WHERE status='approved'),0) AS approved,
            COALESCE(SUM(amount) FILTER (WHERE status='released'),0) AS released
     FROM commissions WHERE user_id=$1`, [userId]);
  const [t] = await query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE status IN ('verified','released')),0) AS total,
            COALESCE(SUM(amount) FILTER (WHERE status='released'),0) AS released,
            COALESCE(SUM(amount) FILTER (WHERE status='pending'),0) AS pending FROM tips WHERE user_id=$1`, [userId]);
  const [b] = await query(
    `SELECT COALESCE(SUM(amount),0) AS total, COALESCE(SUM(amount) FILTER (WHERE status='released'),0) AS released FROM bonuses WHERE user_id=$1`, [userId]);
  const [p] = await query(
    `SELECT COALESCE(SUM(amount),0) AS pending_initial FROM payments WHERE user_id=$1 AND kind='initial' AND status='pending'`, [userId]);
  const settings = await getSettings();
  const n = (x) => Math.round(parseFloat(x) * 100);
  const pendingEstimate = Math.round(n(p.pending_initial) * settings.commission_percent / 100);
  const totalPotentialC = n(c.locked) + n(c.eligible) + n(c.approved) + n(c.released) + n(t.total) + n(b.total);
  const f = (cents) => (cents / 100).toFixed(2);
  const m = (x) => parseFloat(x).toFixed(2);
  return {
    commission_rate_percent: settings.commission_percent,
    total_potential: f(totalPotentialC),
    locked: m(c.locked), eligible: m(c.eligible), approved: m(c.approved), released: m(c.released),
    awaiting_verification_estimate: f(pendingEstimate),
    tips_total: m(t.total), tips_released: m(t.released), tips_pending: m(t.pending),
    bonuses_total: m(b.total), bonuses_released: m(b.released),
  };
}
export { PCT };

export async function spawnNextRecurrence(t) {
  if (!t || t.recurrence === "none") return null;
  const days = t.recurrence === "daily" ? 1 : 7;
  const base = t.deadline ? new Date(t.deadline) : new Date();
  const next = new Date(base.getTime() + days * 86400e3);
  const [row] = await query(
    `INSERT INTO tasks(title,description,assigned_to,created_by,kind,group_id,deadline,priority,category,client_id,platform_id,
       recurrence,requires_evidence,checklist)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) RETURNING *`,
    [t.title, t.description, t.assigned_to, t.created_by, t.kind, t.group_id, next.toISOString(), t.priority, t.category,
      t.client_id, t.platform_id, t.recurrence, t.requires_evidence,
      JSON.stringify((t.checklist || []).map((i) => ({ text: i.text, done: false })))]);
  if (t.kind === "official") await notify(t.assigned_to, "task_assigned", "Recurring task scheduled", row.title, "#/tasks");
  return row;
}
export const TASK_EFF = `CASE WHEN t.status IN ('not_started','in_progress') AND t.deadline IS NOT NULL AND t.deadline < now() THEN 'overdue' ELSE t.status END`;
