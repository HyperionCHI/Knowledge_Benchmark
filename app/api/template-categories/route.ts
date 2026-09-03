import { ensureTemplateSchema, getBindings, toTemplateCategory, type TemplateCategoryRow } from "../../../db/templates";
import { requireEditor, requireSignedIn } from "../../lib/authorize";
import { categoryWriteError, normalizeCategoryInput } from "../../lib/category-validation";

export async function GET(request: Request) {
  const denied = await requireSignedIn(request); if (denied) return denied;
  try {
    await ensureTemplateSchema();
    const result = await getBindings().DB.prepare(`SELECT c.*, COUNT(t.id) AS template_count
      FROM template_categories c LEFT JOIN templates t ON t.category_id = c.id
      GROUP BY c.id ORDER BY c.name COLLATE NOCASE`).all<TemplateCategoryRow>();
    return Response.json({ categories: result.results.map(toTemplateCategory) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "模板分类读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = await requireEditor(request); if (denied) return denied;
  try {
    await ensureTemplateSchema();
    const body = await request.json() as Record<string, unknown>;
    const { name, description, color } = normalizeCategoryInput(body);
    if (!name) return Response.json({ error: "分类名称不能为空。" }, { status: 400 });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await getBindings().DB.prepare("INSERT INTO template_categories (id, name, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, name, description, color, now, now).run();
    return Response.json({ category: { id, name, description, color, templateCount: 0, createdAt: now, updatedAt: now } }, { status: 201 });
  } catch (error) {
    return Response.json({ error: categoryWriteError(error, "分类保存失败") }, { status: 400 });
  }
}
