import { ensureWorkspaceAssetSchema, getWorkspaceAssetBindings } from "../../../db/workspace-assets";
import { getWorkspaceAccess } from "../../lib/authorize";
import { safeAttachmentName } from "../../lib/file-policy";
import { ensureWorkspaceRecordSchema } from "../../../db/workspace-records";
import { GENERAL_KNOWLEDGE_SPACE_ID, OTHER_KNOWLEDGE_SPACE_ID, ensureKnowledgeSchema, getKnowledgeDocument } from "../../../db/knowledge";
import { knowledgeDocumentPermission } from "../../lib/knowledge-permissions";
import { isWorkspaceScopeAllowed } from "../../lib/workspace-scopes";

const clean = (value: FormDataEntryValue | null) => String(value ?? "").trim();

function matchesDocument(scope: string, document: NonNullable<ReturnType<typeof getKnowledgeDocument>>, productId: string | undefined) {
  if (scope === "doc") return document.space_id === GENERAL_KNOWLEDGE_SPACE_ID;
  if (scope === "other-doc") return document.space_id === OTHER_KNOWLEDGE_SPACE_ID;
  return scope === "sop" && document.space_kind === "sop" && Boolean(productId) && document.product_id === productId;
}

export async function POST(request: Request) {
  let storageKey: string | null = null;
  try {
    const form = await request.formData();
    const scope = clean(form.get("scope")); const brand = clean(form.get("brand")); const product = clean(form.get("product")); const documentId = clean(form.get("documentId"));
    if (scope !== "doc" && scope !== "other-doc" && scope !== "sop") return Response.json({ error: "正文图片范围无效。" }, { status: 400 });
    const access = await getWorkspaceAccess(request);
    if (access.denied || !access.profile || !access.session?.user) return access.denied;
    if (!access.state) return Response.json({ error: "工作台状态不可用。" }, { status: 500 });
    ensureWorkspaceRecordSchema(access.state); ensureKnowledgeSchema(access.state);
    const document = documentId ? getKnowledgeDocument(documentId) : null;
    const productId = access.state.productIds[`${brand}/${product}`];
    const documentAllowed = Boolean(document && matchesDocument(scope, document, productId) && knowledgeDocumentPermission(access.state, access.profile, document).canEdit);
    const scopeAllowed = scope === "sop" && access.profile.role === "editor" && isWorkspaceScopeAllowed(access.state, access.profile.scopes, brand, product);
    if (access.profile.role !== "admin" && !scopeAllowed && !documentAllowed) return Response.json({ error: "没有正文图片上传权限。" }, { status: 403 });
    const value = form.get("file"); const file = value instanceof File ? value : null;
    if (!file) return Response.json({ error: "请选择图片。" }, { status: 400 });
    const imageTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!imageTypes.includes(file.type)) return Response.json({ error: "正文图片仅支持 PNG、JPG、WebP 或 GIF。" }, { status: 400 });
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) return Response.json({ error: "正文图片大小需在 10 MB 以内。" }, { status: 400 });
    await ensureWorkspaceAssetSchema();
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    storageKey = `workspace/inline-images/${id}/${safeAttachmentName(file.name)}`;
    const { DB, ATTACHMENTS } = getWorkspaceAssetBindings();
    await ATTACHMENTS.put(storageKey, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { originalName: file.name } });
    await DB.prepare(`INSERT INTO workspace_inline_images (id, scope, brand, product, name, content_type, size, storage_key, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, scope, brand, product, file.name, file.type, file.size, storageKey, access.session.user.name, now).run();
    return Response.json({ image: { id, name: file.name, url: `/api/inline-images/${id}` } }, { status: 201 });
  } catch (error) {
    if (storageKey) { try { await getWorkspaceAssetBindings().ATTACHMENTS.delete(storageKey); } catch { /* best effort */ } }
    return Response.json({ error: error instanceof Error ? error.message : "正文图片上传失败。" }, { status: 500 });
  }
}
