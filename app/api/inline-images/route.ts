import { ensureWorkspaceAssetSchema, getWorkspaceAssetBindings } from "../../../db/workspace-assets";
import { getWorkspaceAccess } from "../../lib/authorize";
import { safeAttachmentName } from "../../lib/file-policy";
import { ensureWorkspaceRecordSchema } from "../../../db/workspace-records";
import { ensureKnowledgeSchema } from "../../../db/knowledge";
import { canEditWorkspaceScope } from "../../lib/workspace-permissions";
import { isKnowledgeAttachmentScope, resolveKnowledgeAttachmentAccess } from "../../lib/knowledge-attachment-access";

const clean = (value: FormDataEntryValue | null) => String(value ?? "").trim();

export async function POST(request: Request) {
  let storageKey: string | null = null;
  try {
    const form = await request.formData();
    const scope = clean(form.get("scope")); const brand = clean(form.get("brand")); const product = clean(form.get("product")); const documentId = clean(form.get("documentId"));
    if (!isKnowledgeAttachmentScope(scope)) return Response.json({ error: "正文图片范围无效。" }, { status: 400 });
    const access = await getWorkspaceAccess(request);
    if (access.denied || !access.profile || !access.session?.user) return access.denied;
    if (!access.state) return Response.json({ error: "工作台状态不可用。" }, { status: 500 });
    ensureWorkspaceRecordSchema(access.state); ensureKnowledgeSchema(access.state);
    const documentAllowed = resolveKnowledgeAttachmentAccess(access.state, access.profile, { scope, brand, product }, documentId)?.canEdit ?? false;
    const scopeAllowed = scope === "sop" && canEditWorkspaceScope(access.state, access.profile, brand, product);
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
