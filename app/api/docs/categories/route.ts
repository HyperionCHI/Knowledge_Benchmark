import { currentSession } from "../../../lib/auth";
import { audit, ensureWorkspaceRecordSchema, snapshotVersion } from "../../../../db/workspace-records";
import { readWorkspaceSnapshot } from "../../../../db/workspace";
import { sqlite } from "../../../../db/local";
import { GENERAL_KNOWLEDGE_SPACE_ID, OTHER_KNOWLEDGE_SPACE_ID, ensureKnowledgeSchema } from "../../../../db/knowledge";

type CategoryRow = { id: string; name: string; parent_id: string | null; sort_order: number };
type DocumentRow = { id: string; category_id: string; title: string; version: number; deleted_at: string | null; [key: string]: unknown };

async function requireAdmin(request: Request) {
  const session = await currentSession(request);
  if (!session?.user) return { denied: Response.json({ error: "请先登录。" }, { status: 401 }), user: null };
  if ((session.user as typeof session.user & { role?: string }).role !== "admin") return { denied: Response.json({ error: "只有管理员可以维护资料分类。" }, { status: 403 }), user: null };
  return { denied: null, user: session.user };
}

export async function POST(request: Request) {
  const access = await requireAdmin(request); if (access.denied || !access.user) return access.denied;
  try {
    const body = await request.json() as { action?: "create" | "rename" | "delete"; space?: "other"; categoryId?: string; parentId?: string | null; name?: string; newName?: string; revision?: number };
    const name = body.name?.trim() || ""; const newName = body.newName?.trim() || "";
    if (!body.action || !name || typeof body.revision !== "number") return Response.json({ error: "分类操作参数不完整。" }, { status: 400 });
    if (name.length > 40 || newName.length > 40) return Response.json({ error: "分类名称不能超过 40 个字。" }, { status: 400 });
    const snapshot = await readWorkspaceSnapshot(); const state = snapshot.state; ensureWorkspaceRecordSchema(state); ensureKnowledgeSchema(state);
    const spaceId = body.space === "other" ? OTHER_KNOWLEDGE_SPACE_ID : GENERAL_KNOWLEDGE_SPACE_ID;
    const readCategories = () => sqlite.prepare(`SELECT id, name, parent_id, sort_order FROM knowledge_categories
      WHERE space_id = ? ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, sort_order, name`).all(spaceId) as CategoryRow[];
    const categories = readCategories();
    const current = body.categoryId ? categories.find((category) => category.id === body.categoryId) : categories.find((category) => category.name === name);
    const now = new Date().toISOString();
    let deletedDocumentIds: string[] = [];
    let deletedCategoryIds: string[] = [];
    if (body.action === "create") {
      if (categories.some((category) => category.name === name)) return Response.json({ error: "该分类已经存在。" }, { status: 409 });
      const parent = body.parentId ? categories.find((category) => category.id === body.parentId) : null;
      if (body.parentId && !parent) return Response.json({ error: "上级分类不存在。" }, { status: 404 });
      if (parent?.parent_id) return Response.json({ error: "资料目录最多支持二级分类。" }, { status: 400 });
      sqlite.prepare(`INSERT INTO knowledge_categories (id, space_id, parent_id, name, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM knowledge_categories WHERE space_id = ? AND parent_id IS ?), 0), ?, ?)`)
        .run(crypto.randomUUID(), spaceId, parent?.id || null, name, spaceId, parent?.id || null, now, now);
    } else if (body.action === "rename") {
      if (!newName) return Response.json({ error: "请输入新的分类名称。" }, { status: 400 });
      if (!current) return Response.json({ error: "原分类不存在。" }, { status: 404 });
      if (newName !== current.name && categories.some((category) => category.name === newName)) return Response.json({ error: "新的分类名称已经存在。" }, { status: 409 });
      sqlite.prepare("UPDATE knowledge_categories SET name = ?, updated_at = ? WHERE id = ?").run(newName, now, current.id);
    } else {
      if (!current) return Response.json({ error: "分类不存在。" }, { status: 404 });
      if (!current.parent_id && categories.filter((category) => !category.parent_id).length <= 1) return Response.json({ error: "至少需要保留一个一级分类。" }, { status: 400 });
      const children = categories.filter((category) => category.parent_id === current.id);
      deletedCategoryIds = [current.id, ...children.map((category) => category.id)];
      const fallback = current.parent_id
        ? categories.find((category) => category.id === current.parent_id)
        : categories.find((category) => !category.parent_id && !deletedCategoryIds.includes(category.id));
      if (!fallback) return Response.json({ error: "找不到用于承接回收文件的保留分类。" }, { status: 409 });
      const placeholders = deletedCategoryIds.map(() => "?").join(",");
      const documents = sqlite.prepare(`SELECT * FROM knowledge_documents WHERE category_id IN (${placeholders})`).all(...deletedCategoryIds) as DocumentRow[];
      deletedDocumentIds = documents.filter((document) => !document.deleted_at).map((document) => document.id);
      sqlite.transaction(() => {
        for (const document of documents) {
          if (document.deleted_at) {
            sqlite.prepare("UPDATE knowledge_documents SET category_id = ? WHERE id = ?").run(fallback.id, document.id);
            continue;
          }
          snapshotVersion("doc", document.id, document.version, document, access.user.name);
          sqlite.prepare(`UPDATE knowledge_documents SET category_id = ?, deleted_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
            .run(fallback.id, now, access.user.name, now, document.id);
        }
        if (children.length) sqlite.prepare(`DELETE FROM knowledge_categories WHERE id IN (${children.map(() => "?").join(",")})`).run(...children.map((category) => category.id));
        sqlite.prepare("DELETE FROM knowledge_categories WHERE id = ?").run(current.id);
      })();
    }
    const updated = readCategories();
    const categoryNames = updated.map((category) => category.name);
    if (body.space === "other") state.otherDocCategories = categoryNames; else state.docCategories = categoryNames;
    const revision = snapshot.revision;
    const detail = body.action === "rename" ? `${name} → ${newName}` : body.action === "delete" ? `${name} · ${deletedCategoryIds.length} 个分类 · ${deletedDocumentIds.length} 个文件移入回收站` : name;
    audit({ id: access.user.id, name: access.user.name }, body.action, "doc-category", current?.id || name, `${body.space === "other" ? "其它资料" : "通用资料"} / ${detail}`);
    return Response.json({ categories: categoryNames, categoryRecords: updated.map((category) => ({ id: category.id, name: category.name, parentId: category.parent_id, sortOrder: category.sort_order })), deletedDocumentIds, deletedCategoryIds, revision, renamedFrom: body.action === "rename" ? name : null, renamedTo: body.action === "rename" ? newName : null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "分类操作失败。" }, { status: 500 });
  }
}
