import { query } from "./db.mjs";
import { getSettings } from "./settings.mjs";
import { phToday, addDays } from "./util.mjs";

const dow = (d) => new Date(d + "T00:00:00Z").getUTCDay();
function workingDays(from, to, days) {
  const out = []; for (let d = from; d <= to; d = addDays(d, 1)) if (days.includes(dow(d))) out.push(d); return out;
}
const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Transparent rule-based scoring. Counts only: verified posts (not pending/rejected/duplicate),
 * admin-confirmed clients, verified project payments (never tips) on confirmed clients,
 * submitted/approved audits and verified official tasks.
 * Posts, clients and revenue are scaled against the team's best; audits and tasks are absolute rates.
 */
export async function computeRankings(from, to) {
  const s = await getSettings();
  const today = phToday();
  const phHour = new Date(Date.now() + 8 * 3600e3).getUTCHours();
  const staff = await query(
    `SELECT u.id, u.full_name, u.staff_code, u.position, u.joined_at, u.avatar_file,
      (SELECT count(*)::int FROM posts p WHERE p.user_id=u.id AND p.status='verified' AND p.posted_on BETWEEN $1 AND $2) AS verified_posts,
      (SELECT count(*)::int FROM posts p WHERE p.user_id=u.id AND p.status IN ('pending','verified') AND p.posted_on BETWEEN $1 AND $2) AS valid_posts,
      (SELECT count(*)::int FROM clients c WHERE c.user_id=u.id AND c.confirmed_at IS NOT NULL AND c.acquired_on BETWEEN $1 AND $2) AS confirmed_clients,
      (SELECT COALESCE(SUM(py.amount),0) FROM payments py JOIN clients c ON c.id=py.client_id
         WHERE c.user_id=u.id AND c.confirmed_at IS NOT NULL AND py.status='verified' AND py.paid_on BETWEEN $1 AND $2) AS verified_revenue,
      (SELECT count(*)::int FROM audits a WHERE a.user_id=u.id AND a.status IN ('submitted','approved') AND a.audit_date BETWEEN $1 AND $2) AS audits_done,
      (SELECT array_agg(a.audit_date::text) FROM audits a WHERE a.user_id=u.id AND a.status IN ('submitted','approved') AND a.audit_date BETWEEN $1 AND $2) AS audit_dates,
      (SELECT count(*)::int FROM tasks t WHERE t.assigned_to=u.id AND t.kind='official' AND t.parent_id IS NULL AND t.status<>'cancelled'
         AND COALESCE((t.deadline AT TIME ZONE 'Asia/Manila')::date,(t.created_at AT TIME ZONE 'Asia/Manila')::date) BETWEEN $1 AND $2) AS official_tasks,
      (SELECT count(*)::int FROM tasks t WHERE t.assigned_to=u.id AND t.kind='official' AND t.parent_id IS NULL AND t.status='completed'
         AND COALESCE((t.deadline AT TIME ZONE 'Asia/Manila')::date,(t.created_at AT TIME ZONE 'Asia/Manila')::date) BETWEEN $1 AND $2) AS official_done,
      (SELECT count(*)::int FROM tasks t WHERE t.assigned_to=u.id AND t.status IN ('not_started','in_progress') AND t.deadline < now()) AS overdue_tasks,
      (SELECT count(*)::int FROM tasks t WHERE t.assigned_to=u.id AND t.kind='official' AND t.status IN ('not_started','in_progress') AND t.deadline < now()) AS overdue_official,
      (SELECT count(*)::int FROM clients c WHERE c.user_id=u.id AND c.acquired_on BETWEEN $1 AND $2) AS clients_added,
      (SELECT count(*)::int FROM tasks t WHERE t.assigned_to=u.id AND t.status='completed' AND (t.completed_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2) AS tasks_completed
     FROM users u WHERE u.role='staff' AND u.status='active' ORDER BY u.id`, [from, to]);

  const maxOf = (k) => Math.max(0, ...staff.map((x) => parseFloat(x[k])));
  const max = { posts: maxOf("verified_posts"), clients: maxOf("confirmed_clients"), revenue: maxOf("verified_revenue") };
  const w = s.weights;
  for (const x of staff) {
    const start = x.joined_at > from ? x.joined_at : from;
    let end = to; if (end >= today && phHour < s.audit_reminder_hour) end = addDays(today, -1);
    const expected = workingDays(start, end, s.working_days);
    const done = new Set(x.audit_dates || []);
    x.audit_expected = expected.length;
    x.missing_audits = expected.filter((d) => !done.has(d)).length;
    x.audit_rate = expected.length ? Math.min(1, expected.filter((d) => done.has(d)).length / expected.length) : null;
    x.task_rate = x.official_tasks ? x.official_done / x.official_tasks : null;
    x.verified_revenue = parseFloat(x.verified_revenue).toFixed(2);
    x.activity = x.valid_posts + x.audits_done + x.tasks_completed + x.clients_added;
    const parts = [
      ["verified_posts", max.posts ? x.verified_posts / max.posts : 0],
      ["confirmed_clients", max.clients ? x.confirmed_clients / max.clients : 0],
      ["verified_revenue", max.revenue ? parseFloat(x.verified_revenue) / max.revenue : 0],
      ["audit_consistency", x.audit_rate],
      ["task_completion", x.task_rate],
    ].filter(([, v]) => v !== null);
    const wsum = parts.reduce((a, [k]) => a + (w[k] || 0), 0);
    x.score = wsum ? round1(parts.reduce((a, [k, v]) => a + (w[k] || 0) * v, 0) / wsum * 100) : 0;
    x.score_parts = Object.fromEntries(parts.map(([k, v]) => [k, round1(v * 100)]));
    delete x.audit_dates;
  }
  staff.sort((a, b) => b.score - a.score || b.verified_posts - a.verified_posts);
  staff.forEach((x, i) => (x.rank = i + 1));

  const platformRows = await query(
    `SELECT pl.kind AS platform,
       count(DISTINCT p.id) FILTER (WHERE p.status IN ('pending','verified'))::int AS posts,
       count(DISTINCT p.id) FILTER (WHERE p.status='verified')::int AS verified_posts
     FROM platforms pl LEFT JOIN posts p ON p.platform_id=pl.id AND p.posted_on BETWEEN $1 AND $2
     JOIN users u ON u.id=pl.user_id AND u.status='active' GROUP BY pl.kind`, [from, to]);
  const clientRows = await query(
    `SELECT pl.kind AS platform, count(DISTINCT c.id) FILTER (WHERE c.confirmed_at IS NOT NULL)::int AS clients,
       COALESCE(SUM(py.amount) FILTER (WHERE py.status='verified' AND py.paid_on BETWEEN $1 AND $2),0) AS revenue
     FROM platforms pl JOIN clients c ON c.platform_id=pl.id AND c.acquired_on BETWEEN $1 AND $2
     LEFT JOIN payments py ON py.client_id=c.id GROUP BY pl.kind`, [from, to]);
  const pw = s.platform_weights;
  const platforms = platformRows.map((p) => {
    const c = clientRows.find((x) => x.platform === p.platform) || { clients: 0, revenue: 0 };
    const revenue = parseFloat(c.revenue);
    return { ...p, confirmed_clients: c.clients, verified_revenue: revenue.toFixed(2),
      score: round1(p.verified_posts * pw.verified_posts + c.clients * pw.confirmed_clients + (revenue / 1000) * pw.revenue_per_1000) };
  }).sort((a, b) => b.score - a.score);

  const top = (key, filter = (x) => x[key] > 0) => {
    const c = staff.filter(filter).sort((a, b) => parseFloat(b[key]) - parseFloat(a[key]));
    return c.length ? { id: c[0].id, name: c[0].full_name, value: c[0][key] } : null;
  };
  const highlights = {
    best_overall: staff.length && staff[0].score > 0 ? { id: staff[0].id, name: staff[0].full_name, value: staff[0].score } : null,
    most_active: top("activity"),
    most_verified_posts: top("verified_posts"),
    most_confirmed_clients: top("confirmed_clients"),
    highest_verified_revenue: top("verified_revenue", (x) => parseFloat(x.verified_revenue) > 0),
    most_consistent_audits: (() => { const c = staff.filter((x) => x.audit_rate !== null && x.audits_done > 0).sort((a, b) => b.audit_rate - a.audit_rate || b.audits_done - a.audits_done)[0]; return c ? { id: c.id, name: c.full_name, value: Math.round(c.audit_rate * 100) } : null; })(),
    best_task_completion: (() => { const c = staff.filter((x) => x.task_rate !== null && x.official_done > 0).sort((a, b) => b.task_rate - a.task_rate || b.official_done - a.official_done)[0]; return c ? { id: c.id, name: c.full_name, value: Math.round(c.task_rate * 100) } : null; })(),
    best_platform: platforms[0] && platforms[0].score > 0 ? { name: platforms[0].platform, value: platforms[0].score } : null,
    overdue_tasks: staff.filter((x) => x.overdue_tasks > 0).map((x) => ({ id: x.id, name: x.full_name, value: x.overdue_tasks })),
    missing_audits: staff.filter((x) => x.missing_audits > 0).map((x) => ({ id: x.id, name: x.full_name, value: x.missing_audits })),
  };
  return {
    from, to, staff, platforms, highlights,
    formula: {
      weights: w, platform_weights: pw,
      description: "Score = weighted average of: verified posts and confirmed clients and verified revenue (each scaled against the team's best), audit consistency (submitted ÷ expected working days) and official task completion rate. Rejected, duplicate and pending posts, unconfirmed clients, unverified payments and tips are excluded. Components with no data are left out of the average.",
    },
  };
}
