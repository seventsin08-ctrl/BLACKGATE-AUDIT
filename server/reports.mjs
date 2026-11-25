import { query } from "./db.mjs";
import { toCsv } from "./util.mjs";
import { computeRankings } from "./perf.mjs";
import { SEC_HEADERS } from "./util.mjs";

export function csvResponse(name, { columns, rows }) {
  return new Response("﻿" + toCsv(rows, columns), {
    headers: { ...SEC_HEADERS, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="blackgate-${name}.csv"` },
  });
}
const cols = (rows, fallback) => ({ columns: rows.length ? Object.keys(rows[0]) : fallback, rows });

/** Build report rows. userId restricts to one staff member (staff exports, staff inspection). */
export async function buildReport(type, { from, to, userId = null }) {
  const p = [from, to]; let u = "";
  if (userId) { p.push(userId); u = `AND x.user_id=$3`; }
  switch (type) {
    case "posts": return cols(await query(
      `SELECT x.id, s.full_name AS staff, COALESCE(pl.name,'') AS platform, x.url, x.title, x.campaign, x.posted_on, x.submitted_at, x.status
       FROM posts x JOIN users s ON s.id=x.user_id LEFT JOIN platforms pl ON pl.id=x.platform_id WHERE x.posted_on BETWEEN $1 AND $2 ${u} ORDER BY x.id`, p), ["id", "staff", "platform", "url"]);
    case "clients": return cols(await query(
      `SELECT x.id, s.full_name AS staff, x.name AS client, x.service, x.price, x.status, x.acquired_on, (x.confirmed_at IS NOT NULL) AS confirmed,
         COALESCE((SELECT SUM(amount) FROM payments WHERE client_id=x.id AND status='verified'),0) AS verified_paid
       FROM clients x JOIN users s ON s.id=x.user_id WHERE x.acquired_on BETWEEN $1 AND $2 ${u} ORDER BY x.id`, p), ["id", "staff", "client"]);
    case "payments": return cols(await query(
      `SELECT x.id, s.full_name AS staff, c.name AS client, x.kind, x.amount, x.paid_on, x.status, x.verified_at
       FROM payments x JOIN users s ON s.id=x.user_id JOIN clients c ON c.id=x.client_id WHERE x.paid_on BETWEEN $1 AND $2 ${u} ORDER BY x.id`, p), ["id", "staff", "client"]);
    case "commissions": return cols(await query(
      `SELECT x.id, s.full_name AS staff, c.name AS client, x.base_amount, x.rate_percent, x.amount, x.status, x.eligible_at, x.approved_at, x.released_at, x.payout_method, x.payout_ref
       FROM commissions x JOIN users s ON s.id=x.user_id JOIN clients c ON c.id=x.client_id WHERE x.updated_at::date BETWEEN $1 AND $2 ${u} ORDER BY x.id`, p), ["id", "staff", "client"]);
    case "tips": return cols(await query(
      `SELECT x.id, s.full_name AS staff, x.amount, x.note, x.received_on, x.status FROM tips x JOIN users s ON s.id=x.user_id WHERE x.received_on BETWEEN $1 AND $2 ${u} ORDER BY x.id`, p), ["id", "staff", "amount"]);
    case "bonuses": return cols(await query(
      `SELECT x.id, s.full_name AS staff, x.amount, x.reason, x.status, x.created_at, x.released_at FROM bonuses x JOIN users s ON s.id=x.user_id WHERE x.created_at::date BETWEEN $1 AND $2 ${u} ORDER BY x.id`, p), ["id", "staff", "amount"]);
    case "tasks": return cols(await query(
      `SELECT x.id, s.full_name AS staff, x.title, x.kind, x.priority, x.category, x.status, x.deadline, x.completed_at, x.verified_at
       FROM tasks x JOIN users s ON s.id=x.assigned_to WHERE x.created_at::date BETWEEN $1 AND $2 ${u.replace("x.user_id", "x.assigned_to")} ORDER BY x.id`, p), ["id", "staff", "title"]);
    case "audits": return cols(await query(
      `SELECT x.id, s.full_name AS staff, x.audit_date, x.status, x.revision, x.submitted_at, x.reviewed_at,
         (x.snapshot->>'total_posts')::int AS posts, x.review_note
       FROM audits x JOIN users s ON s.id=x.user_id WHERE x.audit_date BETWEEN $1 AND $2 ${u} ORDER BY x.audit_date, x.id`, p), ["id", "staff", "audit_date"]);
    case "activity": return cols(await query(
      `SELECT id, created_at, actor_name, action, target_type, target_id, detail::text AS detail, ip FROM activity_logs WHERE created_at::date BETWEEN $1 AND $2 ORDER BY id`, [from, to]), ["id", "created_at", "action"]);
    case "rankings": {
      const r = await computeRankings(from, to);
      return cols(r.staff.map((x) => ({ rank: x.rank, staff: x.full_name, score: x.score, verified_posts: x.verified_posts, confirmed_clients: x.confirmed_clients, verified_revenue: x.verified_revenue, audits_done: x.audits_done, missing_audits: x.missing_audits, official_tasks: x.official_tasks, official_done: x.official_done, overdue_tasks: x.overdue_tasks })), ["rank"]);
    }
    case "platforms": return cols((await computeRankings(from, to)).platforms, ["platform"]);
    default: return null;
  }
}
