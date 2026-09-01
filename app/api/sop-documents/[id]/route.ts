import { getWorkspaceAccess } from "../../../lib/authorize";
import { knowledgeDocumentPermission } from "../../../lib/knowledge-permissions";
import { resolveKnowledgeAttachments } from "../../../lib/doc-attachments";
import { audit, ensureWorkspaceRecordSchema, resolveProductNames, snapshotVersion } from "../../../../db/workspace-records";
import { ensureKnowledgeSchema, getDocumentAttachments, getDocumentCollaborators, getKnowledgeCategory, getKnowledgeDocument, syncDocumentAssets, syncDocumentCollaborators } from "../../../../db/knowledge";
import { sqlite } from "../../../../db/local";
import { isDocumentTreeIcon, isDocumentTreeIconColor } from "../../../lib/knowledge-document-style";

async function accessDocument(request: Request, id: string) {
  const access = await getWorkspaceAccess(request);
  if (access.denied || !access.profile || !access.session?.user || !access.state) return { denied: access.denied, access: null, document: null, target: null };
  ensureWorkspaceRecordSchema(access.state); ensureKnowledgeSchema(access.state);
  const document = getKnowledgeDocument(id);
  if (!document || document.space_kind !== "sop" || document.deleted_at || !document.product_id) return { denied: Response.json({ error: "SOP 文档不存在。" }, { status: 404 }), access: null, document: null, target: null };
  const target = resolveProductNames(access.state, document.product_id);
  if (!target) return { denied: Response.json({ error: "产品不存在。" }, { status: 404 }), access: null, document: null, target: null };
  if (!knowledgeDocumentPermission(access.state, access.profile, document).canEdit) return { denied: Response.json({ error: "没有该文档的编辑权限。" }, { status: 403 }), access: null, document: null, target: null };
  return { denied: null, access, document, target };
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id, result = await accessDocument(request, id);
  if (result.denied || !result.access || !result.document || !result.target || !result.access.session?.user) return result.denied || Response.json({ error: "SOP 访问状态异常。" }, { status: 500 });
  const body = await request.json() as { group?: string; title?: string; body?: string; items?: string[]; attachments?: unknown; version?: number; status?: string; treeIcon?: string; treeIconColor?: string; collaborators?: Array<{ userId: string; permission: "view" | "edit" }> };
  const title = body.title?.trim() || "", content = body.body?.trim() || "";
  if (!title || !content || typeof body.version !== "number") return Response.json({ error: "SOP 文档内容或版本不正确。" }, { status: 400 });
  if (body.version !== result.document.version) return Response.json({ error: "SOP 文档已被其他成员修改，请刷新后重试。", conflict: true }, { status: 409 });
  const group = body.group?.trim() || "产品资料", category = getKnowledgeCategory(result.document.space_id, group);
  if (!category) return Response.json({ error: "所选 SOP 分类不存在。" }, { status: 400 });
  const currentAttachments = getDocumentAttachments(id);
  let attachments;
  try { attachments = body.attachments === undefined ? currentAttachments : await resolveKnowledgeAttachments(body.attachments, ["sop"], id); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "SOP 附件数据无效。" }, { status: 400 }); }
  snapshotVersion("sop", id, result.document.version, result.document, result.access.session.user.name);
  const status = ["draft", "published", "archived"].includes(body.status || "") ? body.status! : result.document.status;
  if (body.treeIcon !== undefined && !isDocumentTreeIcon(body.treeIcon)) return Response.json({ error: "文件树图标无效。" }, { status: 400 });
  if (body.treeIconColor !== undefined && !isDocumentTreeIconColor(body.treeIconColor)) return Response.json({ error: "文件树图标颜色无效。" }, { status: 400 });
  const treeIcon = body.treeIcon || result.document.tree_icon, treeIconColor = (body.treeIconColor || result.document.tree_icon_color).toLowerCase();
  const now = new Date().toISOString(), nextVersion = result.document.version + 1;
  sqlite.prepare("UPDATE knowledge_documents SET category_id = ?, title = ?, body = ?, items_json = ?, status = ?, tree_icon = ?, tree_icon_color = ?, updated_by = ?, updated_at = ?, version = ? WHERE id = ? AND version = ?")
    .run(category.id, title, content, JSON.stringify(body.items || []), status, treeIcon, treeIconColor, result.access.session.user.name, now, nextVersion, id, result.document.version);
  syncDocumentAssets(id, attachments.map((item) => item.id), content);
  if (result.access.profile.role === "admin" && body.collaborators) syncDocumentCollaborators(id, body.collaborators, result.access.session.user.name);
  audit({ id: result.access.session.user.id, name: result.access.session.user.name }, "update", "sop", id, `${result.target.brand} / ${result.target.product} / ${title}`);
  return Response.json({ sop: { id, categoryId: category.id, ...result.target, group, title, content, items: body.items || [], attachments: getDocumentAttachments(id), collaborators: getDocumentCollaborators(id), updatedBy: result.access.session.user.name, updatedAt: now, version: nextVersion, status, treeIcon, treeIconColor } });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id, result = await accessDocument(request, id);
  if (result.denied || !result.access || !result.document || !result.target || !result.access.session?.user) return result.denied || Response.json({ error: "SOP 访问状态异常。" }, { status: 500 });
  snapshotVersion("sop", id, result.document.version, result.document, result.access.session.user.name);
  const now = new Date().toISOString();
  sqlite.prepare("UPDATE knowledge_documents SET deleted_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, result.access.session.user.name, now, id);
  audit({ id: result.access.session.user.id, name: result.access.session.user.name }, "delete", "sop", id, `${result.target.brand} / ${result.target.product} / ${result.document.title}`);
  return Response.json({ deleted: true });
}
