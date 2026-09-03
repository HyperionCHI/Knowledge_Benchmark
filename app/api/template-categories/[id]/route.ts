import { ensureTemplateSchema, getBindings } from "../../../../db/templates";
import { requireEditor } from "../../../lib/authorize";
import { categoryWriteError, normalizeCategoryInput } from "../../../lib/category-validation";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireEditor(request);
  if (denied) return denied;
  try {
    await ensureTemplateSchema();
    const id = (await params).id;
    const body = await request.json() as Record<string, unknown>;
    const { name, description, color } = normalizeCategoryInput(body);
    if (!name) return Response.json({ error: "分类名称不能为空。" }, { status: 400 });
    const { DB } = getBindings();
    const existing = await DB.prepare("SELECT id FROM template_categories WHERE id = ?").bind(id).first<{ id: string }>();
    if (!existing) return Response.json({ error: "分类不存在。" }, { status: 404 });
    const updatedAt = new Date().toISOString();
    await DB.batch([
      DB.prepare("UPDATE template_categories SET name = ?, description = ?, color = ?, updated_at = ? WHERE id = ?").bind(name, description, color, updatedAt, id),
      DB.prepare("UPDATE templates SET category = ?, updated_at = ? WHERE category_id = ?").bind(name, updatedAt, id),
    ]);
    return Response.json({ updated: true });
  } catch (error) {
    return Response.json({ error: categoryWriteError(error, "分类更新失败") }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireEditor(_request);
  if (denied) return denied;
  try {
    await ensureTemplateSchema();
    const id = (await params).id;
    const { DB } = getBindings();
    const count = await DB.prepare("SELECT COUNT(*) AS total FROM templates WHERE category_id = ?").bind(id).first<{ total: number }>();
    if (Number(count?.total ?? 0) > 0) return Response.json({ error: "该分类下仍有模板，请先移动或删除这些模板。" }, { status: 409 });
    await DB.prepare("DELETE FROM template_categories WHERE id = ?").bind(id).run();
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "分类删除失败" }, { status: 500 });
  }
}
