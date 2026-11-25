import pg from "pg";
import { getDatabase } from "@netlify/database";

// DATE columns come back as plain "YYYY-MM-DD" strings (no timezone shifting).
const types = { getTypeParser: (oid, fmt) => (oid === 1082 ? (v) => v : pg.types.getTypeParser(oid, fmt)) };

let override = null; // tests inject a pg.Pool
let cached = null;
export function setPool(p) { override = p; }
function pool() {
  if (override) return override;
  if (!cached) cached = getDatabase().pool;
  return cached;
}
export async function query(text, params = []) {
  const r = await pool().query({ text, values: params, types });
  return r.rows;
}
export async function one(text, params = []) {
  const rows = await query(text, params);
  return rows[0] || null;
}
export async function tx(fn) {
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    const run = async (t, p = []) => (await c.query({ text: t, values: p, types })).rows;
    const out = await fn(run);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    try { await c.query("ROLLBACK"); } catch {}
    throw e;
  } finally { c.release(); }
}
