import { ensureTemplateSchema, getBindings, toTemplateCategory, type TemplateCategoryRow } from "../../../db/templates";
import { requireEditor, requireSignedIn } from "../../lib/authorize";

const clean = (value: unknown) => String(value ?? "").trim();
const colorValue = (value: unknown) => /^#[0-9a-f]{6}$/i.test(clean(value)) ? clean(value) : "#124f9f";

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
    const name = clean(body.name);
    if (!name) return Response.json({ error: "分类名称不能为空。" }, { status: 400 });
    const id = crypto.randomUUID();
    const description = clean(body.description);
    const color = colorValue(body.color);
    const now = new Date().toISOString();
    await getBindings().DB.prepare("INSERT INTO template_categories (id, name, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, name, description, color, now, now).run();
    return Response.json({ category: { id, name, description, color, templateCount: 0, createdAt: now, updatedAt: now } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("UNIQUE") ? "分类名称已存在。" : error instanceof Error ? error.message : "分类保存失败";
    return Response.json({ error: message }, { status: 400 });
  }
}
