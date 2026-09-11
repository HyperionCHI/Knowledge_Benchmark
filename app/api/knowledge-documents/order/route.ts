import { getWorkspaceAccess } from "../../../lib/authorize";
import { canEditGeneralContent, canEditWorkspaceScope } from "../../../lib/workspace-permissions";
import { audit, ensureWorkspaceRecordSchema, resolveProductNames } from "../../../../db/workspace-records";
import { GENERAL_KNOWLEDGE_SPACE_ID, OTHER_KNOWLEDGE_SPACE_ID, ensureKnowledgeSchema, getKnowledgeCategory, getKnowledgeSpace } from "../../../../db/knowledge";
import { sqlite } from "../../../../db/local";

type OrderBody = {
  kind?: "general" | "other" | "sop";
  entity?: "documents" | "categories";
  productId?: string;
  categoryId?: string;
  parentId?: string | null;
  group?: string;
  ids?: string[];
};

function sameIds(current: string[], requested: string[]) {
  return current.length === requested.length && current.every((id) => requested.includes(id)) && new Set(requested).size === requested.length;
}

export async function PUT(request: Request) {
  const access = await getWorkspaceAccess(request);
  if (access.denied || !access.profile || !access.session?.user || !access.state) return access.denied;
  const body = await request.json() as OrderBody;
  const entity = body.entity || "documents";
  if (!body.kind || !["general", "other", "sop"].includes(body.kind) || !["documents", "categories"].includes(entity) || !Array.isArray(body.ids) || !body.ids.every((id) => typeof id === "string" && id.length > 0)) {
    return Response.json({ error: "排序参数不正确。" }, { status: 400 });
  }
  ensureWorkspaceRecordSchema(access.state); ensureKnowledgeSchema(access.state);

  let space: ReturnType<typeof getKnowledgeSpace>;
  if (body.kind === "sop") {
    const target = body.productId ? resolveProductNames(access.state, body.productId) : null;
    if (!target) return Response.json({ error: "产品不存在。" }, { status: 404 });
    if (!canEditWorkspaceScope(access.state, access.profile, target.brand, target.product)) {
      return Response.json({ error: "没有该产品的排序权限。" }, { status: 403 });
    }
    space = getKnowledgeSpace("sop", body.productId);
  } else {
    if (!canEditGeneralContent(access.profile)) return Response.json({ error: "当前账号没有资料排序权限。" }, { status: 403 });
    const spaceId = body.kind === "other" ? OTHER_KNOWLEDGE_SPACE_ID : GENERAL_KNOWLEDGE_SPACE_ID;
    space = sqlite.prepare("SELECT id, kind, brand_id, product_id, title FROM knowledge_spaces WHERE id = ?").get(spaceId) as NonNullable<ReturnType<typeof getKnowledgeSpace>> | undefined;
  }
  if (!space) return Response.json({ error: "知识空间不存在。" }, { status: 404 });

  const now = new Date().toISOString();
  if (entity === "categories") {
    const parentId = body.parentId || null;
    if (parentId) {
      const parent = sqlite.prepare("SELECT id FROM knowledge_categories WHERE id = ? AND space_id = ? AND parent_id IS NULL").get(parentId, space.id);
      if (!parent) return Response.json({ error: "上级分类不存在。" }, { status: 404 });
    }
    const current = (sqlite.prepare("SELECT id FROM knowledge_categories WHERE space_id = ? AND parent_id IS ? ORDER BY sort_order, name")
      .all(space.id, parentId) as Array<{ id: string }>).map((row) => row.id);
    if (!sameIds(current, body.ids)) return Response.json({ error: "文件夹列表已变化，请刷新后重试。", conflict: true }, { status: 409 });
    sqlite.transaction(() => body.ids!.forEach((id, index) => sqlite.prepare("UPDATE knowledge_categories SET sort_order = ?, updated_at = ? WHERE id = ? AND space_id = ?").run(index, now, id, space!.id)))();
    audit({ id: access.session.user.id, name: access.session.user.name }, "reorder", "knowledge-category", parentId || space.id, `${body.kind} · ${body.ids.length} 个文件夹`);
    return Response.json({ ordered: true, entity, ids: body.ids });
  }

  const category = body.categoryId
    ? sqlite.prepare("SELECT id, name FROM knowledge_categories WHERE id = ? AND space_id = ?").get(body.categoryId, space.id) as { id: string; name: string } | undefined
    : body.group?.trim() ? getKnowledgeCategory(space.id, body.group.trim()) : undefined;
  if (!category) return Response.json({ error: "分类不存在。" }, { status: 404 });
  const current = (sqlite.prepare("SELECT id FROM knowledge_documents WHERE space_id = ? AND category_id = ? AND deleted_at IS NULL ORDER BY sort_order, created_at")
    .all(space.id, category.id) as Array<{ id: string }>).map((row) => row.id);
  if (!sameIds(current, body.ids)) return Response.json({ error: "文件列表已变化，请刷新后重试。", conflict: true }, { status: 409 });
  sqlite.transaction(() => body.ids!.forEach((id, index) => sqlite.prepare("UPDATE knowledge_documents SET sort_order = ? WHERE id = ? AND space_id = ? AND category_id = ?").run(index, id, space!.id, category.id)))();
  audit({ id: access.session.user.id, name: access.session.user.name }, "reorder", body.kind === "sop" ? "sop" : "doc", category.id, `${category.name} · ${body.ids.length} 个文件`);
  return Response.json({ ordered: true, entity, ids: body.ids });
}
