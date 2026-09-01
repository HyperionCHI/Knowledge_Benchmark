import { ensureTemplateSchema, getBindings, type TemplateRow } from "../../../../../db/templates";
import { requireSignedIn } from "../../../../lib/authorize";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSignedIn(_request);
  if (denied) return denied;
  await ensureTemplateSchema();
  const { id } = await params;
  const { DB, ATTACHMENTS } = getBindings();
  const row = await DB.prepare("SELECT attachment_key, attachment_name, attachment_type FROM templates WHERE id = ?").bind(id).first<Pick<TemplateRow, "attachment_key" | "attachment_name" | "attachment_type">>();
  if (!row?.attachment_key || !row.attachment_name) return Response.json({ error: "附件不存在" }, { status: 404 });
  const object = await ATTACHMENTS.get(row.attachment_key);
  if (!object) return Response.json({ error: "附件文件不存在" }, { status: 404 });
  const encodedName = encodeURIComponent(row.attachment_name);
  return new Response(object.body, { headers: { "Content-Type": row.attachment_type || object.httpMetadata?.contentType || "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`, "Content-Length": String(object.size), "Cache-Control": "private, max-age=60" } });
}
