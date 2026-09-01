import { ensureWorkspaceAssetSchema, getWorkspaceAssetBindings, toWorkspaceAttachment, type WorkspaceAttachmentRow } from "../../../../../db/workspace-assets";
import { getWorkspaceAccess } from "../../../../lib/authorize";
import { safeAttachmentName, validateWorkspaceFile } from "../../../../lib/file-policy";
import { knowledgeDocumentPermission } from "../../../../lib/knowledge-permissions";
import { ensureWorkspaceRecordSchema } from "../../../../../db/workspace-records";
import { GENERAL_KNOWLEDGE_SPACE_ID, OTHER_KNOWLEDGE_SPACE_ID, ensureKnowledgeSchema, getKnowledgeDocument } from "../../../../../db/knowledge";

async function context(request: Request, id: string) {
  await ensureWorkspaceAssetSchema();
  const row = await getWorkspaceAssetBindings().DB.prepare("SELECT * FROM workspace_attachments WHERE id = ?").bind(id).first<WorkspaceAttachmentRow>();
  if (!row) return { denied: Response.json({ error: "附件不存在。" }, { status: 404 }), row: null, access: null };
  const access = await getWorkspaceAccess(request);
  if (access.denied || !access.profile || !access.session?.user) return { denied: access.denied, row: null, access: null };
  return { denied: null, row, access };
}

function matchesDocument(row: WorkspaceAttachmentRow, document: NonNullable<ReturnType<typeof getKnowledgeDocument>>, productId: string | undefined) {
  if (row.scope === "doc") return document.space_id === GENERAL_KNOWLEDGE_SPACE_ID;
  if (row.scope === "other-doc") return document.space_id === OTHER_KNOWLEDGE_SPACE_ID;
  return row.scope === "sop" && document.space_kind === "sop" && Boolean(productId) && document.product_id === productId;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await context(request, (await params).id);
  if (result.denied || !result.row || !result.access?.profile || !result.access.state) return result.denied;
  ensureWorkspaceRecordSchema(result.access.state); ensureKnowledgeSchema(result.access.state);
  const document = result.row.document_id ? getKnowledgeDocument(result.row.document_id) : null;
  const productId = result.access.state.productIds[`${result.row.brand}/${result.row.product}`];
  if (!document || document.deleted_at || !matchesDocument(result.row, document, productId) || !knowledgeDocumentPermission(result.access.state, result.access.profile, document).canView) return Response.json({ error: "没有该附件的访问权限。" }, { status: 403 });
  const versions = await getWorkspaceAssetBindings().DB.prepare(`SELECT id, version, name, content_type, size, created_by, created_at
    FROM workspace_attachment_versions WHERE attachment_id = ? ORDER BY version DESC`).bind(result.row.id).all<Record<string, unknown>>();
  return Response.json({ versions: versions.results });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let storageKey: string | null = null;
  const result = await context(request, (await params).id);
  if (result.denied || !result.row || !result.access?.profile || !result.access.session?.user) return result.denied;
  if (!result.access.state) return Response.json({ error: "工作台状态不可用。" }, { status: 500 });
  ensureWorkspaceRecordSchema(result.access.state); ensureKnowledgeSchema(result.access.state);
  let form: FormData; try { form = await request.formData(); } catch { return Response.json({ error: "资源版本表单无效。" }, { status: 400 }); }
  const document = result.row.document_id ? getKnowledgeDocument(result.row.document_id) : null;
  const productId = result.access.state.productIds[`${result.row.brand}/${result.row.product}`];
  if (!document || document.deleted_at || !matchesDocument(result.row, document, productId) || !knowledgeDocumentPermission(result.access.state, result.access.profile, document).canEdit) return Response.json({ error: "没有该附件的版本更新权限。" }, { status: 403 });
  try {
    const value = form.get("file"), file = value instanceof File ? value : null;
    if (!file) return Response.json({ error: "请选择新版本文件。" }, { status: 400 });
    const invalid = validateWorkspaceFile(file); if (invalid) return Response.json({ error: invalid }, { status: 400 });
    const { DB, ATTACHMENTS } = getWorkspaceAssetBindings();
    const current = await DB.prepare("SELECT COALESCE(MAX(version), 0) AS value FROM workspace_attachment_versions WHERE attachment_id = ?").bind(result.row.id).first<{ value: number }>();
    const version = Number(current?.value || 0) + 1, now = new Date().toISOString();
    storageKey = `workspace/${result.row.scope}/${result.row.id}/versions/v${version}-${safeAttachmentName(file.name)}`;
    await ATTACHMENTS.put(storageKey, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { originalName: file.name, version: String(version) } });
    await DB.batch([
      DB.prepare(`INSERT INTO workspace_attachment_versions (id, attachment_id, version, name, content_type, size, storage_key, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), result.row.id, version, file.name, file.type || "application/octet-stream", file.size, storageKey, result.access.session.user.name, now),
      DB.prepare("UPDATE workspace_attachments SET name = ?, content_type = ?, size = ?, storage_key = ?, updated_by = ?, updated_at = ? WHERE id = ?")
        .bind(file.name, file.type || "application/octet-stream", file.size, storageKey, result.access.session.user.name, now, result.row.id),
    ]);
    const row = await DB.prepare(`SELECT a.*, (SELECT MAX(version) FROM workspace_attachment_versions v WHERE v.attachment_id = a.id) AS version
      FROM workspace_attachments a WHERE a.id = ?`).bind(result.row.id).first<WorkspaceAttachmentRow & { version: number }>();
    return Response.json({ attachment: row ? toWorkspaceAttachment(row) : null, version });
  } catch (error) {
    if (storageKey) { try { await getWorkspaceAssetBindings().ATTACHMENTS.delete(storageKey); } catch { /* best effort */ } }
    return Response.json({ error: error instanceof Error ? error.message : "附件版本上传失败。" }, { status: 500 });
  }
}
