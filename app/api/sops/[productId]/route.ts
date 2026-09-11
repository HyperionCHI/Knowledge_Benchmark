import { getWorkspaceAccess } from "../../../lib/authorize";
import { canEditWorkspaceScope } from "../../../lib/workspace-permissions";
import { audit, ensureWorkspaceRecordSchema, resolveProductNames, snapshotVersion } from "../../../../db/workspace-records";
import { DEFAULT_SOP_CATEGORY, ensureKnowledgeSchema, getKnowledgeCategory, getKnowledgeSpace, type KnowledgeDocumentRow } from "../../../../db/knowledge";
import { sqlite } from "../../../../db/local";

// Compatibility endpoint for older clients. New clients create and edit individual
// SOP documents through /api/sop-documents; this route updates the product's first document.
export async function PUT(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const access = await getWorkspaceAccess(request);
  if (access.denied || !access.profile || !access.session?.user || !access.state) return access.denied;
  const productId = (await params).productId, target = resolveProductNames(access.state, productId);
  if (!target) return Response.json({ error: "产品不存在。" }, { status: 404 });
  if (!canEditWorkspaceScope(access.state, access.profile, target.brand, target.product)) return Response.json({ error: "没有该产品的编辑权限。" }, { status: 403 });
  const body = await request.json() as { content?: string; version?: number }, content = body.content?.trim() || "";
  if (!content) return Response.json({ error: "SOP 正文不能为空。" }, { status: 400 });
  ensureWorkspaceRecordSchema(access.state); ensureKnowledgeSchema(access.state);
  const space = getKnowledgeSpace("sop", productId);
  if (!space) return Response.json({ error: "SOP 知识空间不存在。" }, { status: 404 });
  const current = sqlite.prepare(`SELECT d.*, c.name AS category_name, s.kind AS space_kind, s.brand_id, s.product_id
    FROM knowledge_documents d JOIN knowledge_categories c ON c.id = d.category_id JOIN knowledge_spaces s ON s.id = d.space_id
    WHERE d.space_id = ? AND d.deleted_at IS NULL ORDER BY d.sort_order, d.created_at LIMIT 1`).get(space.id) as KnowledgeDocumentRow | undefined;
  const now = new Date().toISOString();
  if (current) {
    if (typeof body.version !== "number" || current.version !== body.version) return Response.json({ error: "SOP 已被其他成员修改，请刷新后重试。", conflict: true }, { status: 409 });
    snapshotVersion("sop", current.id, current.version, current, access.session.user.name);
    const nextVersion = current.version + 1;
    sqlite.prepare("UPDATE knowledge_documents SET body = ?, updated_by = ?, updated_at = ?, version = ? WHERE id = ? AND version = ?").run(content, access.session.user.name, now, nextVersion, current.id, current.version);
    audit({ id: access.session.user.id, name: access.session.user.name }, "update", "sop", current.id, `${target.brand} / ${target.product} / ${current.title}`);
    return Response.json({ sop: { id: current.id, ...target, group: current.category_name, title: current.title, content, items: JSON.parse(current.items_json), attachments: [], updatedBy: access.session.user.name, updatedAt: now, version: nextVersion, status: current.status } });
  }
  if (body.version && body.version > 0) return Response.json({ error: "SOP 状态已变化，请刷新后重试。", conflict: true }, { status: 409 });
  const category = getKnowledgeCategory(space.id, DEFAULT_SOP_CATEGORY);
  if (!category) return Response.json({ error: "SOP 默认分类不存在。" }, { status: 500 });
  const id = crypto.randomUUID();
  sqlite.prepare(`INSERT INTO knowledge_documents (id, space_id, category_id, title, slug, body, items_json, status, created_by, updated_by, created_at, updated_at, version, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, '[]', 'published', ?, ?, ?, ?, 1, 0)`).run(id, space.id, category.id, `${target.product} SOP 总览`, `sop-overview-${id}`, content, access.session.user.name, access.session.user.name, now, now);
  audit({ id: access.session.user.id, name: access.session.user.name }, "create", "sop", id, `${target.brand} / ${target.product}`);
  return Response.json({ sop: { id, ...target, group: category.name, title: `${target.product} SOP 总览`, content, items: [], attachments: [], updatedBy: access.session.user.name, updatedAt: now, version: 1, status: "published" } }, { status: 201 });
}
