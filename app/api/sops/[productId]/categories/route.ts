import { getWorkspaceAccess } from "../../../../lib/authorize";
import { canEditWorkspaceScope } from "../../../../lib/workspace-permissions";
import { audit, ensureWorkspaceRecordSchema, resolveProductNames, snapshotVersion } from "../../../../../db/workspace-records";
import { ensureKnowledgeSchema, getKnowledgeSpace } from "../../../../../db/knowledge";
import { sqlite } from "../../../../../db/local";

type CategoryRow = { id: string; name: string; parent_id: string | null; sort_order: number };
type DocumentRow = { id: string; category_id: string; version: number; deleted_at: string | null; [key: string]: unknown };

export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const access = await getWorkspaceAccess(request);
  if (access.denied || !access.profile || !access.session?.user || !access.state) return access.denied;
  const productId = (await params).productId, target = resolveProductNames(access.state, productId);
  if (!target) return Response.json({ error: "产品不存在。" }, { status: 404 });
  if (!canEditWorkspaceScope(access.state, access.profile, target.brand, target.product)) return Response.json({ error: "没有该产品的编辑权限。" }, { status: 403 });
  try {
    const body = await request.json() as { action?: "create" | "rename" | "delete"; categoryId?: string; parentId?: string | null; name?: string; newName?: string };
    const name = body.name?.trim() || "", newName = body.newName?.trim() || "";
    if (!body.action || !name) return Response.json({ error: "分类操作参数不完整。" }, { status: 400 });
    if (name.length > 40 || newName.length > 40) return Response.json({ error: "分类名称不能超过 40 个字。" }, { status: 400 });
    ensureWorkspaceRecordSchema(access.state); ensureKnowledgeSchema(access.state);
    const space = getKnowledgeSpace("sop", productId);
    if (!space) return Response.json({ error: "SOP 知识空间不存在。" }, { status: 404 });
    const readCategories = () => sqlite.prepare(`SELECT id, name, parent_id, sort_order FROM knowledge_categories
      WHERE space_id = ? ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, sort_order, name`).all(space.id) as CategoryRow[];
    const categories = readCategories();
    const current = body.categoryId ? categories.find((category) => category.id === body.categoryId) : categories.find((category) => category.name === name);
    const now = new Date().toISOString();
    let deletedDocumentIds: string[] = [];
    let deletedCategoryIds: string[] = [];
    if (body.action === "create") {
      if (categories.some((category) => category.name === name)) return Response.json({ error: "该分类已经存在。" }, { status: 409 });
      const parent = body.parentId ? categories.find((category) => category.id === body.parentId) : null;
      if (body.parentId && !parent) return Response.json({ error: "上级分类不存在。" }, { status: 404 });
      if (parent?.parent_id) return Response.json({ error: "SOP 目录最多支持二级分类。" }, { status: 400 });
      sqlite.prepare(`INSERT INTO knowledge_categories (id, space_id, parent_id, name, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM knowledge_categories WHERE space_id = ? AND parent_id IS ?), 0), ?, ?)`)
        .run(crypto.randomUUID(), space.id, parent?.id || null, name, space.id, parent?.id || null, now, now);
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
          snapshotVersion("sop", document.id, document.version, document, access.session.user.name);
          sqlite.prepare(`UPDATE knowledge_documents SET category_id = ?, deleted_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
            .run(fallback.id, now, access.session.user.name, now, document.id);
        }
        if (children.length) sqlite.prepare(`DELETE FROM knowledge_categories WHERE id IN (${children.map(() => "?").join(",")})`).run(...children.map((category) => category.id));
        sqlite.prepare("DELETE FROM knowledge_categories WHERE id = ?").run(current.id);
      })();
    }
    const updated = readCategories();
    const detail = body.action === "rename" ? `${name} → ${newName}` : body.action === "delete" ? `${name} · ${deletedCategoryIds.length} 个分类 · ${deletedDocumentIds.length} 个文件移入回收站` : name;
    audit({ id: access.session.user.id, name: access.session.user.name }, body.action, "sop-category", current?.id || name, `${target.brand} / ${target.product} / ${detail}`);
    return Response.json({ categories: updated.map((category) => ({ id: category.id, ...target, name: category.name, parentId: category.parent_id, sortOrder: category.sort_order })), deletedDocumentIds, deletedCategoryIds });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "SOP 分类操作失败。" }, { status: 500 });
  }
}
