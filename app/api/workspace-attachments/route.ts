import { getWorkspaceAssetBindings, ensureWorkspaceAssetSchema, toWorkspaceAttachment, type WorkspaceAttachmentRow } from "../../../db/workspace-assets";
import { getWorkspaceAccess } from "../../lib/authorize";
import { ensureWorkspaceRecordSchema } from "../../../db/workspace-records";
import { safeAttachmentName, validateWorkspaceFile } from "../../lib/file-policy";
import { knowledgeDocumentPermission } from "../../lib/knowledge-permissions";
import { GENERAL_KNOWLEDGE_SPACE_ID, OTHER_KNOWLEDGE_SPACE_ID, ensureKnowledgeSchema, getKnowledgeDocument } from "../../../db/knowledge";

const clean = (value: FormDataEntryValue | null) => String(value ?? "").trim();

function matchesUploadScope(scope: string, document: NonNullable<ReturnType<typeof getKnowledgeDocument>>, productId: string | undefined) {
  if (scope === "doc") return document.space_id === GENERAL_KNOWLEDGE_SPACE_ID;
  if (scope === "other-doc") return document.space_id === OTHER_KNOWLEDGE_SPACE_ID;
  return scope === "sop" && document.space_kind === "sop" && Boolean(productId) && document.product_id === productId;
}

export async function GET(request: Request) {
  const access = await getWorkspaceAccess(request);
  if (access.denied || !access.profile || !access.state) return access.denied;
  const url = new URL(request.url), scope = url.searchParams.get("scope") || "doc", brand = url.searchParams.get("brand") || "", product = url.searchParams.get("product") || "", documentId = url.searchParams.get("documentId") || "";
  if (scope !== "doc" && scope !== "other-doc" && scope !== "sop") return Response.json({ error: "附件库范围无效。" }, { status: 400 });
  if (!documentId) return Response.json({ error: "请选择要查看附件的文章。" }, { status: 400 });
  ensureWorkspaceRecordSchema(access.state); ensureKnowledgeSchema(access.state); await ensureWorkspaceAssetSchema();
  const document = getKnowledgeDocument(documentId);
  const productId = scope === "sop" ? access.state.productIds[`${brand}/${product}`] : undefined;
  if (!document || document.deleted_at || !matchesUploadScope(scope, document, productId)) return Response.json({ error: "文章不存在或不属于当前附件库。" }, { status: 404 });
  if (!knowledgeDocumentPermission(access.state, access.profile, document).canView) return Response.json({ error: "没有该文章附件库的访问权限。" }, { status: 403 });

  const result = await getWorkspaceAssetBindings().DB.prepare(`SELECT a.*, COUNT(DISTINCT da.document_id) AS reference_count, COALESCE(MAX(av.version), 1) AS version
    FROM workspace_attachments a
    LEFT JOIN knowledge_document_assets da ON da.attachment_id = a.id
    LEFT JOIN workspace_attachment_versions av ON av.attachment_id = a.id
    WHERE a.scope = ? AND a.document_id = ?
    GROUP BY a.id ORDER BY a.updated_at DESC, a.created_at DESC`).bind(scope, documentId).all<WorkspaceAttachmentRow & { reference_count: number; version: number }>();
  return Response.json({ attachments: result.results.map((row) => ({ ...toWorkspaceAttachment(row), referenceCount: Number(row.reference_count || 0) })) });
}

export async function POST(request: Request) {
  let storedKey: string | null = null;
  try {
    const form = await request.formData();
    const brand = clean(form.get("brand")); const product = clean(form.get("product")); const scope = clean(form.get("scope")) || "sop"; const documentId = clean(form.get("documentId"));
    const value = form.get("file"); const file = value instanceof File && value.size > 0 ? value : null;
    const title = clean(form.get("title")) || file?.name || ""; const summary = clean(form.get("summary")); const content = clean(form.get("content"));
    const access = await getWorkspaceAccess(request);
    if (access.denied || !access.profile || !access.session?.user) return access.denied;
    if (scope === "catalog-icon") {
      if (access.profile.role !== "admin") return Response.json({ error: "只有管理员可以上传品牌或产品图标。" }, { status: 403 });
    } else if (scope === "doc" || scope === "other-doc" || scope === "sop") {
      if (!access.state || !documentId) return Response.json({ error: "请选择附件所属文章。" }, { status: 400 });
      ensureWorkspaceRecordSchema(access.state); ensureKnowledgeSchema(access.state);
      const document = getKnowledgeDocument(documentId);
      const productId = scope === "sop" ? access.state.productIds[`${brand}/${product}`] : undefined;
      if (!document || document.deleted_at || !matchesUploadScope(scope, document, productId) || !knowledgeDocumentPermission(access.state, access.profile, document).canEdit) return Response.json({ error: "没有该文章的附件上传权限。" }, { status: 403 });
    } else return Response.json({ error: "附件库范围无效。" }, { status: 400 });

    if (!title) return Response.json({ error: "请输入模板名称。" }, { status: 400 });
    if (scope !== "catalog-icon" && !content && !file) return Response.json({ error: "文本内容和上传附件至少需要填写一项。" }, { status: 400 });
    if (scope === "catalog-icon") {
      if (!file) return Response.json({ error: "请选择图标文件。" }, { status: 400 });
      if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) return Response.json({ error: "图标仅支持 PNG、JPG、WebP 或 GIF。" }, { status: 400 });
      if (file.size > 2 * 1024 * 1024) return Response.json({ error: "图标文件不能超过 2 MB。" }, { status: 400 });
    } else if (file) {
      const invalid = validateWorkspaceFile(file); if (invalid) return Response.json({ error: invalid }, { status: 400 });
    }

    await ensureWorkspaceAssetSchema();
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    storedKey = file ? `workspace/${scope}/${id}/${safeAttachmentName(file.name)}` : `workspace/${scope}/${id}/text-only`;
    const { DB, ATTACHMENTS } = getWorkspaceAssetBindings();
    if (file) await ATTACHMENTS.put(storedKey, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { originalName: file.name } });
    const statements = [DB.prepare(`INSERT INTO workspace_attachments (id, scope, brand, product, document_id, title, summary, content, name, content_type, size, storage_key, created_by, created_at, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, scope, brand, product, scope === "catalog-icon" ? "" : documentId, title, summary, content, file?.name || "", file?.type || "", file?.size || 0, storedKey, access.session.user.name, now, access.session.user.name, now)];
    if (file) statements.push(DB.prepare(`INSERT INTO workspace_attachment_versions (id, attachment_id, version, name, content_type, size, storage_key, created_by, created_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), id, file.name, file.type || "application/octet-stream", file.size, storedKey, access.session.user.name, now));
    await DB.batch(statements);
    const row = await DB.prepare("SELECT * FROM workspace_attachments WHERE id = ?").bind(id).first<WorkspaceAttachmentRow>();
    return Response.json({ attachment: row ? toWorkspaceAttachment(row) : null }, { status: 201 });
  } catch (error) {
    if (storedKey) { try { await getWorkspaceAssetBindings().ATTACHMENTS.delete(storedKey); } catch { /* best effort */ } }
    return Response.json({ error: error instanceof Error ? error.message : "资料保存失败" }, { status: 500 });
  }
}
