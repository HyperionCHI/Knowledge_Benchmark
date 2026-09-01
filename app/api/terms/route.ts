import { getTermSortInitial, listTerms, terminologyDb } from "../../../db/terminology";
import { requireEditor, requireSignedIn } from "../../lib/authorize";

const clean = (value: unknown) => String(value ?? "").trim();

export async function GET(request: Request) {
  const denied = await requireSignedIn(request); if (denied) return denied;
  try {
    const url = new URL(request.url);
    const query = clean(url.searchParams.get("query"));
    const categoryId = clean(url.searchParams.get("category"));
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 24, 1), 200);
    const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
    return Response.json(await listTerms(query, categoryId, limit, offset));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "术语读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = await requireEditor(request); if (denied) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    const categoryId = clean(body.categoryId);
    const chinese = clean(body.chinese);
    const definition = clean(body.definition);
    if (!categoryId || !chinese || !definition) return Response.json({ error: "分类、中文名称和定义不能为空。" }, { status: 400 });
    const DB = terminologyDb();
    const category = await DB.prepare("SELECT id FROM term_categories WHERE id = ?").bind(categoryId).first<{ id: string }>();
    if (!category) return Response.json({ error: "所选分类不存在。" }, { status: 400 });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await DB.prepare(`INSERT INTO terms (
      id, category_id, chinese, abbreviation, english, sort_initial, definition, scenario, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      id, categoryId, chinese, clean(body.abbreviation), clean(body.english), getTermSortInitial(chinese), definition, clean(body.scenario), clean(body.source), now, now,
    ).run();
    return Response.json({ term: { id, categoryId, chinese, abbreviation: clean(body.abbreviation), english: clean(body.english), definition, scenario: clean(body.scenario), source: clean(body.source), createdAt: now, updatedAt: now } }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "术语保存失败" }, { status: 500 });
  }
}
