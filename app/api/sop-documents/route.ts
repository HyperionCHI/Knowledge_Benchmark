import { getWorkspaceAccess } from "../../lib/authorize";
import { canEditWorkspaceScope } from "../../lib/workspace-permissions";
import { resolveKnowledgeAttachments } from "../../lib/doc-attachments";
import { audit, ensureWorkspaceRecordSchema, resolveProductNames } from "../../../db/workspace-records";
import { ensureKnowledgeSchema, getDocumentAttachments, getDocumentCollaborators, getKnowledgeCategory, getKnowledgeSpace, syncDocumentAssets, syncDocumentCollaborators } from "../../../db/knowledge";
import { sqlite } from "../../../db/local";
import { DEFAULT_DOCUMENT_TREE_ICON, DEFAULT_DOCUMENT_TREE_ICON_COLOR, isDocumentTreeIcon, isDocumentTreeIconColor } from "../../lib/knowledge-document-style";

export async function POST(request: Request) {
  const access = await getWorkspaceAccess(request);
  if (access.denied || !access.profile || !access.session?.user || !access.state) return access.denied;
  const body = await request.json() as { productId?: string; group?: string; title?: string; body?: string; items?: string[]; attachments?: unknown; status?: string; treeIcon?: string; treeIconColor?: string; collaborators?: Array<{ userId: string; permission: "view" | "edit" }> };
  const productId = body.productId?.trim() || "", target = resolveProductNames(access.state, productId);
  if (!target) return Response.json({ error: "产品不存在。" }, { status: 404 });
  if (!canEditWorkspaceScope(access.state, access.profile, target.brand, target.product)) return Response.json({ error: "没有该产品的编辑权限。" }, { status: 403 });
  const title = body.title?.trim() || "", content = body.body?.trim() || "";
  if (!title || !content) return Response.json({ error: "标题和正文不能为空。" }, { status: 400 });
  ensureWorkspaceRecordSchema(access.state); ensureKnowledgeSchema(access.state);
  const space = getKnowledgeSpace("sop", productId), group = body.group?.trim() || "产品资料";
  const category = space ? getKnowledgeCategory(space.id, group) : undefined;
  if (!space || !category) return Response.json({ error: "所选 SOP 分类不存在。" }, { status: 400 });
  const id = crypto.randomUUID();
  let attachments;
  try { attachments = await resolveKnowledgeAttachments(body.attachments, ["sop"], id); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "SOP 附件数据无效。" }, { status: 400 }); }
  const now = new Date().toISOString();
  const status = ["draft", "published", "archived"].includes(body.status || "") ? body.status! : "draft";
  if (body.treeIcon !== undefined && !isDocumentTreeIcon(body.treeIcon)) return Response.json({ error: "文件树图标无效。" }, { status: 400 });
  if (body.treeIconColor !== undefined && !isDocumentTreeIconColor(body.treeIconColor)) return Response.json({ error: "文件树图标颜色无效。" }, { status: 400 });
  const treeIcon = body.treeIcon || DEFAULT_DOCUMENT_TREE_ICON, treeIconColor = (body.treeIconColor || DEFAULT_DOCUMENT_TREE_ICON_COLOR).toLowerCase();
  sqlite.prepare(`INSERT INTO knowledge_documents (
    id, space_id, category_id, title, slug, body, items_json, status, tree_icon, tree_icon_color, created_by, updated_by, created_at, updated_at, version, sort_order
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, COALESCE((SELECT MAX(sort_order) + 1 FROM knowledge_documents WHERE space_id = ? AND category_id = ?), 0))`)
    .run(id, space.id, category.id, title, `sop-doc-${id}`, content, JSON.stringify(body.items || []), status, treeIcon, treeIconColor, access.session.user.name, access.session.user.name, now, now, space.id, category.id);
  syncDocumentAssets(id, attachments.map((item) => item.id), content);
  if (access.profile.role === "admin" && body.collaborators) syncDocumentCollaborators(id, body.collaborators, access.session.user.name);
  audit({ id: access.session.user.id, name: access.session.user.name }, "create", "sop", id, `${target.brand} / ${target.product} / ${title}`);
  return Response.json({ sop: { id, categoryId: category.id, ...target, group, title, content, items: body.items || [], attachments: getDocumentAttachments(id), collaborators: getDocumentCollaborators(id), updatedBy: access.session.user.name, updatedAt: now, version: 1, status, treeIcon, treeIconColor } }, { status: 201 });
}
