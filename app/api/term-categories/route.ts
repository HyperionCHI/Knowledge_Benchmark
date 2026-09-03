import { ensureTerminologySchema, listCategories, terminologyDb } from "../../../db/terminology";
import { requireEditor, requireSignedIn } from "../../lib/authorize";
import { categoryWriteError, normalizeCategoryInput } from "../../lib/category-validation";

export async function GET(request: Request) {
  const denied = await requireSignedIn(request); if (denied) return denied;
  try { return Response.json({ categories: await listCategories() }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "分类读取失败" }, { status: 500 }); }
}

export async function POST(request: Request) {
  const denied = await requireEditor(request); if (denied) return denied;
  try {
    await ensureTerminologySchema();
    const body = await request.json() as Record<string, unknown>;
    const { name, description, color } = normalizeCategoryInput(body);
    if (!name) return Response.json({ error: "分类名称不能为空。" }, { status: 400 });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await terminologyDb().prepare("INSERT INTO term_categories (id, name, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, name, description, color, now, now).run();
    return Response.json({ category: { id, name, description, color, termCount: 0, createdAt: now, updatedAt: now } }, { status: 201 });
  } catch (error) {
    return Response.json({ error: categoryWriteError(error, "分类保存失败") }, { status: 400 });
  }
}
