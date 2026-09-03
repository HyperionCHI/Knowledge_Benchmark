import { ensureWorkspaceAssetSchema, getWorkspaceAssetBindings, toWorkspaceAttachment, type WorkspaceAttachmentRow } from "../../../../db/workspace-assets";
import { getWorkspaceAccess } from "../../../lib/authorize";
import { ensureWorkspaceRecordSchema } from "../../../../db/workspace-records";
import { ensureKnowledgeSchema } from "../../../../db/knowledge";
import { validateWorkspaceFile } from "../../../lib/file-policy";
import { isWorkspaceScopeAllowed } from "../../../lib/workspace-scopes";
import { isKnowledgeAttachmentScope, resolveOwnedKnowledgeAttachmentAccess } from "../../../lib/knowledge-attachment-access";
import { createWorkspaceAttachmentVersion } from "../../../lib/workspace-attachment-versions";

const clean = (value: FormDataEntryValue | null) => String(value ?? "").trim();

async function find(id: string) {
  await ensureWorkspaceAssetSchema();
  return getWorkspaceAssetBindings().DB.prepare("SELECT * FROM workspace_attachments WHERE id = ?").bind(id).first<WorkspaceAttachmentRow>();
}

async function mutationAccess(request: Request, row: WorkspaceAttachmentRow, documentId: string) {
  const access = await getWorkspaceAccess(request); if (access.denied || !access.profile || !access.session?.user) return { denied: access.denied, access: null };
  if (!access.state) return { denied: Response.json({ error: "工作台状态不可用。" }, { status: 500 }), access: null };
  ensureWorkspaceRecordSchema(access.state); ensureKnowledgeSchema(access.state);
  const articleScoped = isKnowledgeAttachmentScope(row.scope);
  const documentAllowed = resolveOwnedKnowledgeAttachmentAccess(access.state, access.profile, row, documentId)?.canEdit ?? false;
  if ((articleScoped && !documentAllowed) || (!articleScoped && access.profile.role !== "admin")) return { denied: Response.json({ error: "没有该资源的编辑权限。" }, { status: 403 }), access: null };
  return { denied: null, access };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await getWorkspaceAccess(request); if (access.denied || !access.profile) return access.denied;
  if (access.state) ensureWorkspaceRecordSchema(access.state);
  const row = await find((await params).id); if (!row) return Response.json({ error: "附件不存在。" }, { status: 404 });
  if (isKnowledgeAttachmentScope(row.scope)) {
    if (!access.state) return Response.json({ error: "工作台状态不可用。" }, { status: 500 });
    ensureWorkspaceRecordSchema(access.state); ensureKnowledgeSchema(access.state);
    if (!resolveOwnedKnowledgeAttachmentAccess(access.state, access.profile, row)?.canView) return Response.json({ error: "没有该附件的访问权限。" }, { status: 403 });
  } else if (row.scope === "catalog-icon") {
    const state = access.state;
    if (!state) return Response.json({ error: "工作台状态不可用。" }, { status: 500 });
    if (access.profile.role !== "admin") {
      const reference = `custom:/api/workspace-attachments/${row.id}`, scopes = access.profile.scopes;
      const visibleBrandReference = state.brands.some((brand) => state.brandIcons[brand] === reference && isWorkspaceScopeAllowed(state, scopes, brand));
      const visibleProductReference = state.brands.some((brand) => (state.productsByBrand[brand] || []).some((product) => state.productIcons[`${brand}/${product}`] === reference && isWorkspaceScopeAllowed(state, scopes, brand, product)));
      if (!visibleBrandReference && !visibleProductReference) return Response.json({ error: "没有该附件的访问权限。" }, { status: 403 });
    }
  } else if (access.profile.role !== "admin" && !access.profile.scopes.includes("*") && !access.profile.scopes.includes(row.brand) && !access.profile.scopes.includes(`${row.brand} / ${row.product}`)) return Response.json({ error: "没有该附件的访问权限。" }, { status: 403 });
  const requestedVersion = Number(new URL(request.url).searchParams.get("version") || 0);
  if (requestedVersion <= 0 && (!row.name.trim() || Number(row.size) <= 0)) return Response.json({ error: "该资料没有上传附件。" }, { status: 404 });
  const version = requestedVersion > 0 ? await getWorkspaceAssetBindings().DB.prepare("SELECT * FROM workspace_attachment_versions WHERE attachment_id = ? AND version = ?").bind(row.id, requestedVersion).first<{ storage_key: string; content_type: string; name: string }>() : null;
  if (requestedVersion > 0 && !version) return Response.json({ error: "附件版本不存在。" }, { status: 404 });
  const storageKey = version?.storage_key || row.storage_key, contentType = version?.content_type || row.content_type, name = version?.name || row.name;
  const object = await getWorkspaceAssetBindings().ATTACHMENTS.get(storageKey); if (!object) return Response.json({ error: "附件文件不存在。" }, { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": contentType || object.httpMetadata.contentType, "Content-Disposition": `${contentType.startsWith("image/") || contentType === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`, "Content-Length": String(object.size), "Cache-Control": "private, max-age=60" } });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const row = await find((await params).id); if (!row) return Response.json({ error: "资料不存在。" }, { status: 404 });
    const form = await request.formData(); const documentId = clean(form.get("documentId"));
    const authorization = await mutationAccess(request, row, documentId); if (authorization.denied || !authorization.access?.session?.user) return authorization.denied;
    const title = clean(form.get("title")); const summary = clean(form.get("summary")); const content = clean(form.get("content")); const removeAttachment = clean(form.get("removeAttachment")) === "true";
    const rawFile = form.get("file"); const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null;
    if (!title) return Response.json({ error: "请输入模板名称。" }, { status: 400 });
    if (file) { const invalid = validateWorkspaceFile(file); if (invalid) return Response.json({ error: invalid }, { status: 400 }); }
    const keepsCurrentAttachment = Boolean(row.name.trim() && Number(row.size) > 0 && !removeAttachment);
    if (!content && !file && !keepsCurrentAttachment) return Response.json({ error: "文本内容和上传附件至少需要保留一项。" }, { status: 400 });

    if (file) {
      const result = await createWorkspaceAttachmentVersion(row, file, authorization.access.session.user.name, { title, summary, content });
      return Response.json({ attachment: result.row ? toWorkspaceAttachment(result.row) : null });
    }

    const { DB } = getWorkspaceAssetBindings(); const now = new Date().toISOString();
    const attachmentName = keepsCurrentAttachment ? row.name : ""; const attachmentType = keepsCurrentAttachment ? row.content_type : ""; const attachmentSize = keepsCurrentAttachment ? Number(row.size) : 0; const storageKey = keepsCurrentAttachment ? row.storage_key : `workspace/${row.scope}/${row.id}/text-only`;
    await DB.prepare(`UPDATE workspace_attachments SET title = ?, summary = ?, content = ?, name = ?, content_type = ?, size = ?, storage_key = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
      .bind(title, summary, content, attachmentName, attachmentType, attachmentSize, storageKey, authorization.access.session.user.name, now, row.id).run();
    const updated = await DB.prepare(`SELECT a.*, COALESCE((SELECT MAX(version) FROM workspace_attachment_versions v WHERE v.attachment_id = a.id), 1) AS version FROM workspace_attachments a WHERE a.id = ?`).bind(row.id).first<WorkspaceAttachmentRow & { version: number }>();
    return Response.json({ attachment: updated ? toWorkspaceAttachment(updated) : null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "资料更新失败。" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const row = await find((await params).id); if (!row) return Response.json({ error: "资料不存在。" }, { status: 404 });
  const documentId = new URL(request.url).searchParams.get("documentId") || "";
  const authorization = await mutationAccess(request, row, documentId); if (authorization.denied) return authorization.denied;
  const { DB, ATTACHMENTS } = getWorkspaceAssetBindings();
  const usage = await DB.prepare("SELECT COUNT(*) AS total FROM knowledge_document_assets WHERE attachment_id = ?").bind(row.id).first<{ total: number }>();
  if (Number(usage?.total || 0) > 0) return Response.json({ error: `该附件仍被 ${usage?.total} 篇文档引用，请先从文档中解除关联。`, usage: Number(usage?.total || 0) }, { status: 409 });
  const versions = await DB.prepare("SELECT storage_key FROM workspace_attachment_versions WHERE attachment_id = ?").bind(row.id).all<{ storage_key: string }>();
  await DB.prepare("DELETE FROM workspace_attachments WHERE id = ?").bind(row.id).run();
  await Promise.all([...new Set([row.storage_key, ...versions.results.map((item) => item.storage_key)])].map((key) => ATTACHMENTS.delete(key)));
  return Response.json({ deleted: true });
}
