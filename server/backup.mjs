import { query, tx } from "./db.mjs";
import { blobs } from "./files.mjs";
import { HttpError } from "./util.mjs";

// Dependency order (parents first). Sessions and login events are deliberately excluded.
export const TABLES = ["users", "settings", "files", "platforms", "clients", "posts", "payments", "tips", "bonuses", "commissions",
  "tasks", "note_folders", "notes", "audits", "audit_revisions", "announcements", "notifications", "activity_logs"];
const SERIAL = TABLES.filter((t) => !["settings", "files"].includes(t));
const store = () => blobs("backups");

export async function createBackup(label = "manual", actor = "system") {
  const tables = {};
  for (const t of TABLES) tables[t] = await query(`SELECT * FROM ${t}`);
  const created = new Date().toISOString();
  const key = `${created.replace(/[:.]/g, "-")}_${label}`;
  const body = JSON.stringify({ version: 1, created_at: created, label, tables });
  await store().set(key, body, { metadata: { label, actor, created, rows: String(Object.values(tables).reduce((a, r) => a + r.length, 0)) } });
  await pruneBackups(30);
  return { key, created, label };
}
export async function listBackups() {
  const { blobs: list } = await store().list();
  const out = [];
  for (const b of list) {
    const m = await store().getMetadata(b.key).catch(() => null);
    out.push({ key: b.key, label: m?.metadata?.label || "", created: m?.metadata?.created || null, rows: Number(m?.metadata?.rows || 0), actor: m?.metadata?.actor || "" });
  }
  return out.sort((a, b) => String(b.key).localeCompare(String(a.key)));
}
async function pruneBackups(keep) {
  const all = await listBackups();
  for (const b of all.slice(keep)) await store().delete(b.key);
}
export async function readBackup(key) {
  if (!/^[\w\-:.]+$/.test(key)) throw new HttpError(404, "Not found");
  const text = await store().get(key, { type: "text" });
  if (!text) throw new HttpError(404, "Backup not found");
  return text;
}
export async function deleteBackup(key) { await readBackup(key); await store().delete(key); }

/** Replace all production data with a backup's contents (single transaction). */
export async function restoreBackup(key) {
  const data = JSON.parse(await readBackup(key));
  if (data.version !== 1 || !data.tables) throw new HttpError(400, "Unsupported backup format");
  await createBackup("pre-restore", "system");
  await tx(async (run) => {
    for (const t of [...TABLES].reverse()) await run(`DELETE FROM ${t}`);
    for (const t of TABLES) {
      const rows = data.tables[t] || [];
      if (rows.length) await run(`INSERT INTO ${t} SELECT * FROM jsonb_populate_recordset(null::${t}, $1::jsonb)`, [JSON.stringify(rows)]);
    }
    for (const t of SERIAL) await run(`SELECT setval(pg_get_serial_sequence('${t}','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM ${t}),1), (SELECT COUNT(*)>0 FROM ${t}))`);
  });
  return { restored_from: key, rows: Object.values(data.tables).reduce((a, r) => a + r.length, 0) };
}
