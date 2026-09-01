import { ensureTerminologySchema, getTerm, getTermSortInitial, terminologyDb } from "../../../../db/terminology";
import { requireEditor, requireSignedIn } from "../../../lib/authorize";

const clean = (value: unknown) => String(value ?? "").trim();

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSignedIn(_request);
  if (denied) return denied;
  const term = await getTerm((await params).id);
  return term ? Response.json({ term }) : Response.json({ error: "术语不存在。" }, { status: 404 });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireEditor(request);
  if (denied) return denied;
  try {
    await ensureTerminologySchema();
    const id = (await params).id;
    const body = await request.json() as Record<string, unknown>;
    const categoryId = clean(body.categoryId);
    const chinese = clean(body.chinese);
    const definition = clean(body.definition);
    if (!categoryId || !chinese || !definition) return Response.json({ error: "分类、中文名称和定义不能为空。" }, { status: 400 });
    const DB = terminologyDb();
    const existing = await getTerm(id);
    if (!existing) return Response.json({ error: "术语不存在。" }, { status: 404 });
    const category = await DB.prepare("SELECT id FROM term_categories WHERE id = ?").bind(categoryId).first<{ id: string }>();
    if (!category) return Response.json({ error: "所选分类不存在。" }, { status: 400 });
    const updatedAt = new Date().toISOString();
    await DB.prepare(`UPDATE terms SET category_id = ?, chinese = ?, abbreviation = ?, english = ?, sort_initial = ?, definition = ?, scenario = ?, source = ?, updated_at = ? WHERE id = ?`).bind(
      categoryId, chinese, clean(body.abbreviation), clean(body.english), getTermSortInitial(chinese), definition, clean(body.scenario), clean(body.source), updatedAt, id,
    ).run();
    return Response.json({ term: { ...existing, categoryId, chinese, abbreviation: clean(body.abbreviation), english: clean(body.english), definition, scenario: clean(body.scenario), source: clean(body.source), updatedAt } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "术语更新失败" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireEditor(_request);
  if (denied) return denied;
  try {
    await ensureTerminologySchema();
    const id = (await params).id;
    if (!await getTerm(id)) return Response.json({ error: "术语不存在。" }, { status: 404 });
    await terminologyDb().prepare("DELETE FROM terms WHERE id = ?").bind(id).run();
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "术语删除失败" }, { status: 500 });
  }
}
