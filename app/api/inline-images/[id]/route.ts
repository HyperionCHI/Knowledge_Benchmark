import { ensureWorkspaceAssetSchema, getWorkspaceAssetBindings } from "../../../../db/workspace-assets";
import { getWorkspaceAccess } from "../../../lib/authorize";
import { ensureWorkspaceRecordSchema } from "../../../../db/workspace-records";
import { isWorkspaceScopeAllowed } from "../../../lib/workspace-scopes";

type InlineImageRow = { id: string; scope: string; brand: string; product: string; name: string; content_type: string; size: number; storage_key: string };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await getWorkspaceAccess(request);
  if (access.denied || !access.profile) return access.denied;
  if (access.state) ensureWorkspaceRecordSchema(access.state);
  await ensureWorkspaceAssetSchema();
  const row = await getWorkspaceAssetBindings().DB.prepare("SELECT * FROM workspace_inline_images WHERE id = ?").bind((await params).id).first<InlineImageRow>();
  if (!row) return Response.json({ error: "正文图片不存在。" }, { status: 404 });
  if (row.scope === "sop" && access.profile.role !== "admin" && (!access.state || !isWorkspaceScopeAllowed(access.state, access.profile.scopes, row.brand, row.product))) return Response.json({ error: "没有该正文图片的访问权限。" }, { status: 403 });
  const object = await getWorkspaceAssetBindings().ATTACHMENTS.get(row.storage_key);
  if (!object) return Response.json({ error: "正文图片文件不存在。" }, { status: 404 });
  const contentType = row.content_type || object.httpMetadata.contentType || "application/octet-stream";
  return new Response(object.body, { headers: { "Content-Type": contentType, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`, "Content-Length": String(object.size), "Cache-Control": "private, max-age=3600" } });
}
