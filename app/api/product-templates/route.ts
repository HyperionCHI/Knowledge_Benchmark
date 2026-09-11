import { ensureWorkspaceAssetSchema, getWorkspaceAssetBindings, toProductTemplate, type ProductTemplateRow } from "../../../db/workspace-assets";
import { getWorkspaceAccess, requireWorkspaceEditor } from "../../lib/authorize";
import { safeAttachmentName, validateWorkspaceFile } from "../../lib/file-policy";
import { canViewWorkspaceScope } from "../../lib/workspace-permissions";

const clean = (value: FormDataEntryValue | null) => String(value ?? "").trim();

export async function GET(request: Request) {
  const access = await getWorkspaceAccess(request); if (access.denied || !access.profile) return access.denied;
  await ensureWorkspaceAssetSchema();
  const url = new URL(request.url); const brand = url.searchParams.get("brand")?.trim() || ""; const product = url.searchParams.get("product")?.trim() || "";
  if (!brand || !product) return Response.json({ error: "缺少品牌或产品参数。" }, { status: 400 });
  if (!access.state || !canViewWorkspaceScope(access.state, access.profile, brand, product)) return Response.json({ error: "没有该产品的访问权限。" }, { status: 403 });
  const result = await getWorkspaceAssetBindings().DB.prepare("SELECT * FROM product_templates WHERE brand = ? AND product = ? ORDER BY updated_at DESC").bind(brand, product).all<ProductTemplateRow>();
  return Response.json({ templates: result.results.map(toProductTemplate) });
}

export async function POST(request: Request) {
  let attachmentKey: string | null = null;
  try {
    const form = await request.formData(); const brand = clean(form.get("brand")); const product = clean(form.get("product"));
    const denied = await requireWorkspaceEditor(request, brand, product); if (denied) return denied;
    const access = await getWorkspaceAccess(request); if (!access.session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
    const title = clean(form.get("title")); const summary = clean(form.get("summary")); const content = clean(form.get("content"));
    if (!title || !content) return Response.json({ error: "模板名称和正文不能为空。" }, { status: 400 });
    const rawFile = form.get("attachment"); const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null;
    if (file) { const invalid = validateWorkspaceFile(file); if (invalid) return Response.json({ error: invalid }, { status: 400 }); }
    await ensureWorkspaceAssetSchema(); const { DB, ATTACHMENTS } = getWorkspaceAssetBindings(); const id = crypto.randomUUID(); const now = new Date().toISOString(); let attachmentId: string | null = null;
    if (file) { attachmentId = crypto.randomUUID(); attachmentKey = `workspace/product-template/${attachmentId}/${safeAttachmentName(file.name)}`; await ATTACHMENTS.put(attachmentKey, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" } }); await DB.prepare(`INSERT INTO workspace_attachments (id, scope, brand, product, name, content_type, size, storage_key, created_by, created_at) VALUES (?, 'product-template', ?, ?, ?, ?, ?, ?, ?, ?)`).bind(attachmentId, brand, product, file.name, file.type || "application/octet-stream", file.size, attachmentKey, access.session.user.name, now).run(); }
    await DB.prepare(`INSERT INTO product_templates (id, brand, product, title, summary, content, attachment_id, attachment_name, attachment_size, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, brand, product, title, summary, content, attachmentId, file?.name ?? null, file?.size ?? null, access.session.user.name, access.session.user.name, now, now).run();
    const row = await DB.prepare("SELECT * FROM product_templates WHERE id = ?").bind(id).first<ProductTemplateRow>(); return Response.json({ template: row ? toProductTemplate(row) : null }, { status: 201 });
  } catch (error) { if (attachmentKey) { try { await getWorkspaceAssetBindings().ATTACHMENTS.delete(attachmentKey); } catch { /* best effort */ } } return Response.json({ error: error instanceof Error ? error.message : "模板保存失败" }, { status: 500 }); }
}
