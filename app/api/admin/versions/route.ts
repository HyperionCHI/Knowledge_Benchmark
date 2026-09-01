import { audit, ensureWorkspaceRecordSchema, snapshotVersion } from "../../../../db/workspace-records";
import { sqlite } from "../../../../db/local";
import { getWorkspaceAccess } from "../../../lib/authorize";
import { getKnowledgeDocument } from "../../../../db/knowledge";
import { knowledgeDocumentPermission } from "../../../lib/knowledge-permissions";

type VersionRow = { id: string; entity_type: string; entity_id: string; version: number; payload: string; created_by: string; created_at: string };

function resolveEntityId(type: string, id: string) {
  if (type !== "sop") return id;
  return (sqlite.prepare(`SELECT d.id FROM knowledge_documents d JOIN knowledge_spaces s ON s.id = d.space_id
    WHERE s.kind = 'sop' AND s.product_id = ? AND d.deleted_at IS NULL ORDER BY d.sort_order LIMIT 1`).get(id) as { id: string } | undefined)?.id || id;
}

export async function GET(request: Request) {
  const url = new URL(request.url), type = url.searchParams.get("type") || "", rawId = url.searchParams.get("id") || "";
  if (!rawId || !["doc", "sop", "tracker-link"].includes(type)) return Response.json({ error: "版本目标无效。" }, { status: 400 });
  const id = resolveEntityId(type, rawId);
  const workspace = await getWorkspaceAccess(request); if (workspace.denied || !workspace.profile || !workspace.state) return workspace.denied;
  ensureWorkspaceRecordSchema(workspace.state);
  if (workspace.profile.role !== "admin") {
    const document = type === "doc" || type === "sop" ? getKnowledgeDocument(id) : null;
    if (!document || !knowledgeDocumentPermission(workspace.state, workspace.profile, document).canEdit) return Response.json({ error: "没有该内容的版本查看权限。" }, { status: 403 });
  }
  const versions = sqlite.prepare("SELECT * FROM content_versions WHERE entity_type = ? AND entity_id = ? ORDER BY version DESC LIMIT 100").all(type, id) as VersionRow[];
  return Response.json({ entityId: id, versions: versions.map((row) => ({ id: row.id, entityType: row.entity_type, entityId: row.entity_id, version: row.version, payload: JSON.parse(row.payload), createdBy: row.created_by, createdAt: row.created_at })) });
}

export async function POST(request: Request) {
  const body = await request.json() as { versionId?: string };
  const selected = body.versionId ? sqlite.prepare("SELECT * FROM content_versions WHERE id = ?").get(body.versionId) as VersionRow | undefined : undefined;
  if (!selected) return Response.json({ error: "所选历史版本不存在。" }, { status: 404 });
  const access = await getWorkspaceAccess(request); if (access.denied || !access.profile || !access.state || !access.session?.user) return access.denied;
  ensureWorkspaceRecordSchema(access.state);
  if (access.profile.role !== "admin") {
    const document = selected.entity_type === "doc" || selected.entity_type === "sop" ? getKnowledgeDocument(selected.entity_id) : null;
    if (!document || !knowledgeDocumentPermission(access.state, access.profile, document).canEdit) return Response.json({ error: "没有该内容的版本恢复权限。" }, { status: 403 });
  }
  const user = access.session.user;
  const payload = JSON.parse(selected.payload) as Record<string, unknown>;
  const now = new Date().toISOString();
  const restoredVersion = sqlite.transaction(() => {
    if (selected.entity_type === "doc") {
      const current = sqlite.prepare("SELECT * FROM knowledge_documents WHERE id = ?").get(selected.entity_id) as Record<string, unknown> | undefined;
      if (!current) throw new Error("资料记录不存在，无法恢复。");
      snapshotVersion("doc", selected.entity_id, Number(current.version), current, user.name);
      const next = Number(current.version) + 1;
      const historicalCategoryId = String(payload.category_id || "");
      const restoredCategoryId = historicalCategoryId && sqlite.prepare("SELECT 1 FROM knowledge_categories WHERE id = ?").get(historicalCategoryId) ? historicalCategoryId : String(current.category_id);
      sqlite.prepare("UPDATE knowledge_documents SET category_id = ?, title = ?, body = ?, items_json = ?, status = ?, updated_by = ?, updated_at = ?, version = ?, deleted_at = NULL WHERE id = ?")
        .run(restoredCategoryId, String(payload.title || "未命名资料"), String(payload.body || ""), String(payload.items_json || "[]"), String(payload.status || "published"), user.name, now, next, selected.entity_id);
      return next;
    }
    if (selected.entity_type === "sop") {
      const current = sqlite.prepare("SELECT * FROM knowledge_documents WHERE id = ?").get(selected.entity_id) as Record<string, unknown> | undefined;
      if (!current) throw new Error("SOP 记录不存在，无法恢复。");
      snapshotVersion("sop", selected.entity_id, Number(current.version), current, user.name);
      const next = Number(current.version) + 1;
      const historicalCategoryId = String(payload.category_id || "");
      const restoredCategoryId = historicalCategoryId && sqlite.prepare("SELECT 1 FROM knowledge_categories WHERE id = ?").get(historicalCategoryId) ? historicalCategoryId : String(current.category_id);
      sqlite.prepare("UPDATE knowledge_documents SET category_id = ?, title = ?, body = ?, items_json = ?, status = ?, updated_by = ?, updated_at = ?, version = ?, deleted_at = NULL WHERE id = ?")
        .run(restoredCategoryId, String(payload.title || current.title || "未命名 SOP"), String(payload.body || payload.content || ""), String(payload.items_json || "[]"), String(payload.status || "published"), user.name, now, next, selected.entity_id);
      return next;
    }
    if (selected.entity_type === "tracker-link") {
      const current = sqlite.prepare("SELECT * FROM tracker_links WHERE id = ?").get(selected.entity_id) as Record<string, unknown> | undefined;
      if (!current) throw new Error("跟踪链接记录不存在，无法恢复。");
      snapshotVersion("tracker-link", selected.entity_id, Number(current.version), current, user.name);
      const next = Number(current.version) + 1;
      sqlite.prepare("UPDATE tracker_links SET name = ?, url = ?, cycle = ?, platform = ?, note = ?, color = ?, updated_by = ?, updated_at = ?, version = ?, deleted_at = NULL WHERE id = ?")
        .run(String(payload.name || "未命名链接"), String(payload.url || ""), String(payload.cycle || "daily"), String(payload.platform || ""), String(payload.note || ""), String(payload.color || "#2859e8"), user.name, now, next, selected.entity_id);
      return next;
    }
    throw new Error("该类型暂不支持恢复。");
  })();
  audit({ id: user.id, name: user.name }, "restore-version", selected.entity_type, selected.entity_id, `恢复至历史版本 v${selected.version}`);
  return Response.json({ restored: true, version: restoredVersion });
}
