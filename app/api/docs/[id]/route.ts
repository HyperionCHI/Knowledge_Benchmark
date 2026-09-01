import { getWorkspaceAccess } from "../../../lib/authorize";
import { knowledgeDocumentPermission } from "../../../lib/knowledge-permissions";
import { audit, ensureWorkspaceRecordSchema, snapshotVersion } from "../../../../db/workspace-records";
import { sqlite } from "../../../../db/local";
import { resolveKnowledgeAttachments } from "../../../lib/doc-attachments";
import {
  GENERAL_KNOWLEDGE_SPACE_ID,
  OTHER_KNOWLEDGE_SPACE_ID,
  ensureKnowledgeSchema,
  getDocumentAttachments, getDocumentCollaborators,
  getKnowledgeCategory,
  getKnowledgeDocument,
  syncDocumentAssets, syncDocumentCollaborators,
} from "../../../../db/knowledge";
import { isDocumentTreeIcon, isDocumentTreeIconColor } from "../../../lib/knowledge-document-style";

async function documentAccess(request: Request, id: string) {
  const access = await getWorkspaceAccess(request);
  if (access.denied || !access.profile || !access.session?.user || !access.state) return { denied: access.denied, access: null, document: null };
  ensureWorkspaceRecordSchema(access.state); ensureKnowledgeSchema(access.state);
  const document = getKnowledgeDocument(id);
  const expectedSpaceId = new URL(request.url).searchParams.get("space") === "other" ? OTHER_KNOWLEDGE_SPACE_ID : GENERAL_KNOWLEDGE_SPACE_ID;
  if (!document || document.space_id !== expectedSpaceId || document.deleted_at) return { denied: Response.json({ error: "资料不存在。" }, { status: 404 }), access: null, document: null };
  if (!knowledgeDocumentPermission(access.state, access.profile, document).canEdit) return { denied: Response.json({ error: "没有该文档的编辑权限。" }, { status: 403 }), access: null, document: null };
  return { denied: null, access, document };
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const result = await documentAccess(request, id);
  if (result.denied || !result.access || !result.document || !result.access.session?.user) return result.denied || Response.json({ error: "资料访问状态异常。" }, { status: 500 });
  const body = await request.json() as { group?: string; title?: string; body?: string; items?: string[]; attachments?: unknown; version?: number; status?: string; treeIcon?: string; treeIconColor?: string; collaborators?: Array<{ userId: string; permission: "view" | "edit" }> };
  const other = new URL(request.url).searchParams.get("space") === "other";
  const spaceId = other ? OTHER_KNOWLEDGE_SPACE_ID : GENERAL_KNOWLEDGE_SPACE_ID;
  const title = body.title?.trim() || "", content = body.body?.trim() || "";
  if (!title || !content || typeof body.version !== "number") return Response.json({ error: "资料内容或版本不正确。" }, { status: 400 });
  const current = result.document;
  if (current.version !== body.version) return Response.json({ error: "资料已被其他成员修改，请刷新后重试。", conflict: true }, { status: 409 });
  const group = body.group?.trim() || (other ? "其它资料" : "通用资料");
  const category = getKnowledgeCategory(spaceId, group);
  if (!category) return Response.json({ error: "所选资料分类已不存在，请重新选择。" }, { status: 400 });
  const oldAttachments = getDocumentAttachments(id);
  let attachments;
  try { attachments = body.attachments === undefined ? oldAttachments : await resolveKnowledgeAttachments(body.attachments, [other ? "other-doc" : "doc"], id); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "资料附件数据无效。" }, { status: 400 }); }
  const status = ["draft", "published", "archived"].includes(body.status || "") ? body.status! : current.status;
  if (body.treeIcon !== undefined && !isDocumentTreeIcon(body.treeIcon)) return Response.json({ error: "文件树图标无效。" }, { status: 400 });
  if (body.treeIconColor !== undefined && !isDocumentTreeIconColor(body.treeIconColor)) return Response.json({ error: "文件树图标颜色无效。" }, { status: 400 });
  const treeIcon = body.treeIcon || current.tree_icon, treeIconColor = (body.treeIconColor || current.tree_icon_color).toLowerCase();
  snapshotVersion("doc", id, current.version, current, result.access.session.user.name);
  const now = new Date().toISOString(), nextVersion = current.version + 1;
  sqlite.prepare("UPDATE knowledge_documents SET category_id = ?, title = ?, body = ?, items_json = ?, status = ?, tree_icon = ?, tree_icon_color = ?, updated_by = ?, updated_at = ?, version = ? WHERE id = ? AND version = ?")
    .run(category.id, title, content, JSON.stringify(body.items || []), status, treeIcon, treeIconColor, result.access.session.user.name, now, nextVersion, id, current.version);
  syncDocumentAssets(id, attachments.map((item) => item.id), content);
  if (result.access.profile.role === "admin" && body.collaborators) syncDocumentCollaborators(id, body.collaborators, result.access.session.user.name);
  audit({ id: result.access.session.user.id, name: result.access.session.user.name }, "update", "doc", id, `${other ? "其它资料" : "通用资料"} / ${title}`);
  return Response.json({ doc: { id, categoryId: category.id, group, title, owner: result.access.session.user.name, body: content, items: body.items || [], updatedAt: now, attachments: getDocumentAttachments(id), collaborators: getDocumentCollaborators(id), version: nextVersion, status, treeIcon, treeIconColor } });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id, result = await documentAccess(request, id);
  if (result.denied || !result.access || !result.document || !result.access.session?.user) return result.denied || Response.json({ error: "资料访问状态异常。" }, { status: 500 });
  if (result.access.profile.role !== "admin") return Response.json({ error: "只有管理员可以删除资料。" }, { status: 403 });
  const current = result.document;
  snapshotVersion("doc", id, current.version, current, result.access.session.user.name);
  const now = new Date().toISOString();
  sqlite.prepare("UPDATE knowledge_documents SET deleted_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, result.access.session.user.name, now, id);
  audit({ id: result.access.session.user.id, name: result.access.session.user.name }, "delete", "doc", id, current.title);
  return Response.json({ deleted: true });
}
