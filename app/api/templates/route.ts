import { ensureTemplateSchema, getBindings, toTemplateRecord, type TemplateRow } from "../../../db/templates";
import { requireEditor, requireSignedIn } from "../../lib/authorize";
import { safeAttachmentName, validateWorkspaceFile } from "../../lib/file-policy";

const clean = (value: FormDataEntryValue | null) => String(value ?? "").trim();

export async function GET(request: Request) {
  const denied = await requireSignedIn(request); if (denied) return denied;
  try {
    await ensureTemplateSchema();
    const { DB } = getBindings();
    const result = await DB.prepare(`SELECT t.*, c.name AS category_name
      FROM templates t JOIN template_categories c ON c.id = t.category_id
      ORDER BY t.updated_at DESC, t.created_at DESC`).all<TemplateRow>();
    return Response.json({ templates: result.results.map(toTemplateRecord) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "模板读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = await requireEditor(request); if (denied) return denied;
  let attachmentKey: string | null = null;
  try {
    await ensureTemplateSchema();
    const form = await request.formData();
    const title = clean(form.get("title"));
    const categoryId = clean(form.get("categoryId"));
    const summary = clean(form.get("summary"));
    const content = clean(form.get("content"));
    const attachment = form.get("attachment");
    if (!title || !categoryId) return Response.json({ error: "模板名称和分类不能为空。" }, { status: 400 });

    const file = attachment instanceof File && attachment.size > 0 ? attachment : null;
    if (!content && !file) return Response.json({ error: "文本内容和附件至少需要填写一项。" }, { status: 400 });
    if (file) { const invalid = validateWorkspaceFile(file); if (invalid) return Response.json({ error: invalid }, { status: 400 }); }
    const { DB, ATTACHMENTS } = getBindings();
    const category = await DB.prepare("SELECT name FROM template_categories WHERE id = ?").bind(categoryId).first<{ name: string }>();
    if (!category) return Response.json({ error: "所选分类不存在。" }, { status: 400 });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    if (file) {
      attachmentKey = `templates/${id}/${safeAttachmentName(file.name)}`;
      await ATTACHMENTS.put(attachmentKey, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { originalName: file.name } });
    }

    await DB.prepare(`INSERT INTO templates (
      id, title, category_id, category, summary, content, attachment_key, attachment_name, attachment_type, attachment_size, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      id, title, categoryId, category.name, summary, content, attachmentKey, file?.name ?? null, file?.type || null, file?.size ?? null, now, now,
    ).run();

    return Response.json({ template: { id, title, categoryId, category: category.name, summary, content, attachmentName: file?.name ?? null, attachmentSize: file?.size ?? null, createdAt: now, updatedAt: now } }, { status: 201 });
  } catch (error) {
    if (attachmentKey) { try { await getBindings().ATTACHMENTS.delete(attachmentKey); } catch { /* best-effort cleanup */ } }
    return Response.json({ error: error instanceof Error ? error.message : "模板保存失败" }, { status: 500 });
  }
}
