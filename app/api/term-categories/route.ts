import { ensureTerminologySchema, listCategories, terminologyDb } from "../../../db/terminology";
import { requireEditor, requireSignedIn } from "../../lib/authorize";

const clean = (value: unknown) => String(value ?? "").trim();
const colorValue = (value: unknown) => /^#[0-9a-f]{6}$/i.test(clean(value)) ? clean(value) : "#124f9f";

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
    const name = clean(body.name);
    if (!name) return Response.json({ error: "分类名称不能为空。" }, { status: 400 });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const description = clean(body.description);
    const color = colorValue(body.color);
    await terminologyDb().prepare("INSERT INTO term_categories (id, name, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, name, description, color, now, now).run();
    return Response.json({ category: { id, name, description, color, termCount: 0, createdAt: now, updatedAt: now } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("UNIQUE") ? "分类名称已存在。" : error instanceof Error ? error.message : "分类保存失败";
    return Response.json({ error: message }, { status: 400 });
  }
}
