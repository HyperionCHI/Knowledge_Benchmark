import { getWorkspaceAccess } from "../../lib/authorize";
import { audit, ensureWorkspaceRecordSchema } from "../../../db/workspace-records";
import { sqlite } from "../../../db/local";
import { resolveKnowledgeAttachments } from "../../lib/doc-attachments";
import { GENERAL_KNOWLEDGE_SPACE_ID, OTHER_KNOWLEDGE_SPACE_ID, ensureKnowledgeSchema, getDocumentAttachments, getDocumentCollaborators, getKnowledgeCategory, syncDocumentAssets, syncDocumentCollaborators } from "../../../db/knowledge";
import { DEFAULT_DOCUMENT_TREE_ICON, DEFAULT_DOCUMENT_TREE_ICON_COLOR, isDocumentTreeIcon, isDocumentTreeIconColor } from "../../lib/knowledge-document-style";
import { canEditGeneralContent } from "../../lib/workspace-permissions";

async function editor(request: Request) {
  const access = await getWorkspaceAccess(request);
  if (access.denied || !access.profile || !access.session?.user || !access.state) return { denied: access.denied, access: null };
  if (!canEditGeneralContent(access.profile)) return { denied: Response.json({ error: "当前账号没有通用内容编辑权限。" }, { status: 403 }), access: null };
  return { denied: null, access };
}

export async function POST(request: Request) {
  const authorization = await editor(request); if (authorization.denied || !authorization.access?.session?.user || !authorization.access.state || !authorization.access.profile) return authorization.denied;
  const access = authorization.access; const user = access.session.user;
  const other = new URL(request.url).searchParams.get("space") === "other";
  const spaceId = other ? OTHER_KNOWLEDGE_SPACE_ID : GENERAL_KNOWLEDGE_SPACE_ID;
  const body = await request.json() as { id?: string; group?: string; title?: string; body?: string; items?: string[]; attachments?: unknown; status?: string; treeIcon?: string; treeIconColor?: string; collaborators?: Array<{ userId: string; permission: "view" | "edit" }> };
  const title = body.title?.trim() || "", content = body.body?.trim() || ""; if (!title || !content) return Response.json({ error: "标题和正文不能为空。" }, { status: 400 });
  const state = access.state; ensureWorkspaceRecordSchema(state); ensureKnowledgeSchema(state); const group = body.group?.trim() || (other ? "其它资料" : "通用资料"); const category = getKnowledgeCategory(spaceId, group); if (!category) return Response.json({ error: "所选资料分类已不存在，请重新选择。" }, { status: 400 });
  const id = body.id || crypto.randomUUID();
  let attachments; try { attachments = await resolveKnowledgeAttachments(body.attachments, [other ? "other-doc" : "doc"], id); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "资料附件数据无效。" }, { status: 400 }); }
  const now = new Date().toISOString();
  const status = ["draft", "published", "archived"].includes(body.status || "") ? body.status! : "draft";
  if (body.treeIcon !== undefined && !isDocumentTreeIcon(body.treeIcon)) return Response.json({ error: "文件树图标无效。" }, { status: 400 });
  if (body.treeIconColor !== undefined && !isDocumentTreeIconColor(body.treeIconColor)) return Response.json({ error: "文件树图标颜色无效。" }, { status: 400 });
  const treeIcon = body.treeIcon || DEFAULT_DOCUMENT_TREE_ICON, treeIconColor = (body.treeIconColor || DEFAULT_DOCUMENT_TREE_ICON_COLOR).toLowerCase();
  sqlite.prepare(`INSERT INTO knowledge_documents (
    id, space_id, category_id, title, slug, body, items_json, status, tree_icon, tree_icon_color, created_by, updated_by, created_at, updated_at, version, sort_order
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, COALESCE((SELECT MAX(sort_order) + 1 FROM knowledge_documents WHERE space_id = ? AND category_id = ?), 0))`)
    .run(id, spaceId, category.id, title, `doc-${id}`, content, JSON.stringify(body.items || []), status, treeIcon, treeIconColor, user.name, user.name, now, now, spaceId, category.id);
  syncDocumentAssets(id, attachments.map((item) => item.id), content);
  if (access.profile.role === "admin") syncDocumentCollaborators(id, body.collaborators || [], user.name);
  const storedAttachments = getDocumentAttachments(id);
  audit({ id: user.id, name: user.name }, "create", "doc", id, `${other ? "其它资料" : "通用资料"} / ${title}`);
  return Response.json({ doc: { id, categoryId: category.id, group, title, owner: user.name, body: content, items: body.items || [], updatedAt: now, attachments: storedAttachments, collaborators: getDocumentCollaborators(id), version: 1, status, treeIcon, treeIconColor } }, { status: 201 });
}
