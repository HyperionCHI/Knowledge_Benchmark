import { ensureTemplateSchema, getBindings, getTemplate, type TemplateRow } from "../../../../db/templates";
import { requireEditor, requireSignedIn } from "../../../lib/authorize";
import { safeAttachmentName, validateWorkspaceFile } from "../../../lib/file-policy";

const clean = (value: FormDataEntryValue | null) => String(value ?? "").trim();

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSignedIn(_request);
  if (denied) return denied;
  const template = await getTemplate((await params).id);
  return template ? Response.json({ template }) : Response.json({ error: "模板不存在。" }, { status: 404 });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireEditor(request);
  if (denied) return denied;
  let newAttachmentKey: string | null = null;
  try {
    await ensureTemplateSchema();
    const id = (await params).id;
    const form = await request.formData();
    const title = clean(form.get("title"));
    const categoryId = clean(form.get("categoryId"));
    const summary = clean(form.get("summary"));
    const content = clean(form.get("content"));
    const attachment = form.get("attachment");
    const removeAttachment = clean(form.get("removeAttachment")) === "true";
    if (!title || !categoryId) return Response.json({ error: "模板名称和分类不能为空。" }, { status: 400 });

    const file = attachment instanceof File && attachment.size > 0 ? attachment : null;
    if (file) { const invalid = validateWorkspaceFile(file); if (invalid) return Response.json({ error: invalid }, { status: 400 }); }
    const { DB, ATTACHMENTS } = getBindings();
    const current = await DB.prepare("SELECT attachment_key, attachment_name, attachment_type, attachment_size FROM templates WHERE id = ?").bind(id).first<Pick<TemplateRow, "attachment_key" | "attachment_name" | "attachment_type" | "attachment_size">>();
    if (!current) return Response.json({ error: "模板不存在。" }, { status: 404 });
    const keepsCurrentAttachment = Boolean(current.attachment_key) && !removeAttachment;
    if (!content && !file && !keepsCurrentAttachment) return Response.json({ error: "文本内容和附件至少需要保留一项。" }, { status: 400 });
    const category = await DB.prepare("SELECT name FROM template_categories WHERE id = ?").bind(categoryId).first<{ name: string }>();
    if (!category) return Response.json({ error: "所选分类不存在。" }, { status: 400 });

    let attachmentKey = current.attachment_key;
    let attachmentName = current.attachment_name;
    let attachmentType = current.attachment_type;
    let attachmentSize = current.attachment_size;
    if (file) {
      newAttachmentKey = `templates/${id}/${crypto.randomUUID()}-${safeAttachmentName(file.name)}`;
      await ATTACHMENTS.put(newAttachmentKey, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { originalName: file.name } });
      attachmentKey = newAttachmentKey;
      attachmentName = file.name;
      attachmentType = file.type || null;
      attachmentSize = file.size;
    } else if (removeAttachment) {
      attachmentKey = null; attachmentName = null; attachmentType = null; attachmentSize = null;
    }

    const updatedAt = new Date().toISOString();
    await DB.prepare(`UPDATE templates SET title = ?, category_id = ?, category = ?, summary = ?, content = ?,
      attachment_key = ?, attachment_name = ?, attachment_type = ?, attachment_size = ?, updated_at = ? WHERE id = ?`).bind(
      title, categoryId, category.name, summary, content, attachmentKey, attachmentName, attachmentType, attachmentSize, updatedAt, id,
    ).run();
    if (current.attachment_key && current.attachment_key !== attachmentKey) await ATTACHMENTS.delete(current.attachment_key);
    const template = await getTemplate(id);
    return Response.json({ template });
  } catch (error) {
    if (newAttachmentKey) { try { await getBindings().ATTACHMENTS.delete(newAttachmentKey); } catch { /* best-effort cleanup */ } }
    return Response.json({ error: error instanceof Error ? error.message : "模板更新失败" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireEditor(_request);
  if (denied) return denied;
  try {
    await ensureTemplateSchema();
    const id = (await params).id;
    const { DB, ATTACHMENTS } = getBindings();
    const row = await DB.prepare("SELECT attachment_key FROM templates WHERE id = ?").bind(id).first<Pick<TemplateRow, "attachment_key">>();
    if (!row) return Response.json({ error: "模板不存在。" }, { status: 404 });
    await DB.prepare("DELETE FROM templates WHERE id = ?").bind(id).run();
    if (row.attachment_key) await ATTACHMENTS.delete(row.attachment_key);
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "模板删除失败" }, { status: 500 });
  }
}
