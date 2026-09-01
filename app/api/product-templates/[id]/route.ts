import { ensureWorkspaceAssetSchema, getWorkspaceAssetBindings, toProductTemplate, type ProductTemplateRow, type WorkspaceAttachmentRow } from "../../../../db/workspace-assets";
import { getWorkspaceAccess, requireWorkspaceEditor } from "../../../lib/authorize";
import { safeAttachmentName, validateWorkspaceFile } from "../../../lib/file-policy";

const clean = (value: FormDataEntryValue | null) => String(value ?? "").trim();

async function getRow(id: string) { await ensureWorkspaceAssetSchema(); return getWorkspaceAssetBindings().DB.prepare("SELECT * FROM product_templates WHERE id = ?").bind(id).first<ProductTemplateRow>(); }

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let newKey: string | null = null;
  try {
    const id = (await params).id; const current = await getRow(id); if (!current) return Response.json({ error: "模板不存在。" }, { status: 404 });
    const denied = await requireWorkspaceEditor(request, current.brand, current.product); if (denied) return denied;
    const access = await getWorkspaceAccess(request); if (!access.session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
    const form = await request.formData(); const title = clean(form.get("title")); const summary = clean(form.get("summary")); const content = clean(form.get("content")); const removeAttachment = clean(form.get("removeAttachment")) === "true";
    if (!title || !content) return Response.json({ error: "模板名称和正文不能为空。" }, { status: 400 });
    const rawFile = form.get("attachment"); const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null; if (file) { const invalid = validateWorkspaceFile(file); if (invalid) return Response.json({ error: invalid }, { status: 400 }); }
    const { DB, ATTACHMENTS } = getWorkspaceAssetBindings(); const oldAttachment = current.attachment_id ? await DB.prepare("SELECT * FROM workspace_attachments WHERE id = ?").bind(current.attachment_id).first<WorkspaceAttachmentRow>() : null; let attachmentId = current.attachment_id; let attachmentName = current.attachment_name; let attachmentSize = current.attachment_size;
    if (file) { attachmentId = crypto.randomUUID(); newKey = `workspace/product-template/${attachmentId}/${safeAttachmentName(file.name)}`; await ATTACHMENTS.put(newKey, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" } }); await DB.prepare(`INSERT INTO workspace_attachments (id, scope, brand, product, name, content_type, size, storage_key, created_by, created_at) VALUES (?, 'product-template', ?, ?, ?, ?, ?, ?, ?, ?)`).bind(attachmentId, current.brand, current.product, file.name, file.type || "application/octet-stream", file.size, newKey, access.session.user.name, new Date().toISOString()).run(); attachmentName = file.name; attachmentSize = file.size; }
    else if (removeAttachment) { attachmentId = null; attachmentName = null; attachmentSize = null; }
    const now = new Date().toISOString(); await DB.prepare("UPDATE product_templates SET title = ?, summary = ?, content = ?, attachment_id = ?, attachment_name = ?, attachment_size = ?, updated_by = ?, updated_at = ? WHERE id = ?").bind(title, summary, content, attachmentId, attachmentName, attachmentSize, access.session.user.name, now, id).run();
    if (oldAttachment && oldAttachment.id !== attachmentId) { await DB.prepare("DELETE FROM workspace_attachments WHERE id = ?").bind(oldAttachment.id).run(); await ATTACHMENTS.delete(oldAttachment.storage_key); }
    const row = await getRow(id); return Response.json({ template: row ? toProductTemplate(row) : null });
  } catch (error) { if (newKey) { try { await getWorkspaceAssetBindings().ATTACHMENTS.delete(newKey); } catch { /* best effort */ } } return Response.json({ error: error instanceof Error ? error.message : "模板更新失败" }, { status: 500 }); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const row = await getRow((await params).id); if (!row) return Response.json({ error: "模板不存在。" }, { status: 404 }); const denied = await requireWorkspaceEditor(request, row.brand, row.product); if (denied) return denied;
  const { DB, ATTACHMENTS } = getWorkspaceAssetBindings(); const attachment = row.attachment_id ? await DB.prepare("SELECT * FROM workspace_attachments WHERE id = ?").bind(row.attachment_id).first<WorkspaceAttachmentRow>() : null; await DB.prepare("DELETE FROM product_templates WHERE id = ?").bind(row.id).run(); if (attachment) { await DB.prepare("DELETE FROM workspace_attachments WHERE id = ?").bind(attachment.id).run(); await ATTACHMENTS.delete(attachment.storage_key); } return Response.json({ deleted: true });
}
