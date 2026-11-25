import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";
import { query, one } from "./db.mjs";
import { HttpError, bad, SEC_HEADERS } from "./util.mjs";

let override = null; // tests inject an in-memory store
export const setBlobStore = (s) => { override = s; };
export const blobs = (name = "uploads") => override || getStore({ name, consistency: "strong" });

const MAX = 4 * 1024 * 1024;
function sniff(b) {
  if (b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 4 && b.slice(0, 4).toString() === "GIF8") return "image/gif";
  if (b.length > 12 && b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP") return "image/webp";
  if (b.length > 4 && b.slice(0, 5).toString() === "%PDF-") return "application/pdf";
  return null;
}
/** Upload via multipart/form-data: field "file", optional "kind". Returns the file record. */
export async function handleUpload(ctx) {
  let form;
  try { form = await ctx.req.formData(); } catch { throw bad("Expected a file upload"); }
  const f = form.get("file");
  if (!f || typeof f === "string") throw bad("No file provided");
  if (f.size > MAX) throw new HttpError(413, "File is too large (max 4 MB)");
  const buf = Buffer.from(await f.arrayBuffer());
  const mime = sniff(buf);
  if (!mime) throw bad("Only PNG, JPEG, GIF, WebP images or PDF files are allowed");
  const kind = ["avatar", "screenshot", "receipt", "evidence", "other"].includes(form.get("kind")) ? form.get("kind") : "other";
  if (kind === "avatar" && !mime.startsWith("image/")) throw bad("Profile picture must be an image");
  const id = randomBytes(16).toString("hex");
  await blobs().set(id, buf, { metadata: { owner: String(ctx.user.id) } });
  const name = String(f.name || "").replace(/[^\w.\- ]/g, "").slice(0, 100);
  const [row] = await query(
    "INSERT INTO files(id,owner_id,kind,mime,size,name) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,kind,mime,size,name",
    [id, ctx.user.id, kind, mime, buf.length, name]);
  return row;
}
/** Authorised download: owner or superadmin; avatars are visible to any signed-in user. */
export async function handleDownload(ctx, id) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new HttpError(404, "Not found");
  const f = await one("SELECT * FROM files WHERE id=$1", [id]);
  if (!f) throw new HttpError(404, "Not found");
  const allowed = ctx.user.role === "superadmin" || f.owner_id === ctx.user.id || f.kind === "avatar";
  if (!allowed) throw new HttpError(404, "Not found");
  const data = await blobs().get(id, { type: "arrayBuffer" });
  if (!data) throw new HttpError(404, "File missing");
  return new Response(data, {
    headers: {
      ...SEC_HEADERS, "content-type": f.mime, "cache-control": "private, max-age=300",
      "content-disposition": `${f.mime === "application/pdf" ? "inline" : "inline"}; filename="${f.name || "file"}"`,
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
/** Verify a file id may be attached by this user (owned by them). */
export async function ownFile(userId, id, kinds) {
  if (id === null || id === undefined || id === "") return null;
  const f = await one("SELECT id,owner_id,kind FROM files WHERE id=$1", [String(id)]);
  if (!f || f.owner_id !== userId) throw bad("Attachment not found");
  if (kinds && !kinds.includes(f.kind)) throw bad("Wrong attachment type");
  return f.id;
}
