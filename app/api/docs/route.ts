import { currentSession } from "../../lib/auth";
import { audit, ensureWorkspaceRecordSchema } from "../../../db/workspace-records";
import { readWorkspaceState } from "../../../db/workspace";
import { sqlite } from "../../../db/local";
import { resolveKnowledgeAttachments } from "../../lib/doc-attachments";
import { GENERAL_KNOWLEDGE_SPACE_ID, OTHER_KNOWLEDGE_SPACE_ID, ensureKnowledgeSchema, getDocumentAttachments, getDocumentCollaborators, getKnowledgeCategory, syncDocumentAssets, syncDocumentCollaborators } from "../../../db/knowledge";
import { DEFAULT_DOCUMENT_TREE_ICON, DEFAULT_DOCUMENT_TREE_ICON_COLOR, isDocumentTreeIcon, isDocumentTreeIconColor } from "../../lib/knowledge-document-style";

async function admin(request: Request) {
  const session = await currentSession(request);
  if (!session?.user) return { denied: Response.json({ error: "请先登录。" }, { status: 401 }), user: null };
  if ((session.user as typeof session.user & { role?: string }).role !== "admin") return { denied: Response.json({ error: "只有管理员可以维护资料。" }, { status: 403 }), user: null };
  return { denied: null, user: session.user };
}

export async function POST(request: Request) {
  const access = await admin(request); if (access.denied || !access.user) return access.denied;
  const other = new URL(request.url).searchParams.get("space") === "other";
  const spaceId = other ? OTHER_KNOWLEDGE_SPACE_ID : GENERAL_KNOWLEDGE_SPACE_ID;
  const body = await request.json() as { id?: string; group?: string; title?: string; body?: string; items?: string[]; attachments?: unknown; status?: string; treeIcon?: string; treeIconColor?: string; collaborators?: Array<{ userId: string; permission: "view" | "edit" }> };
  const title = body.title?.trim() || "", content = body.body?.trim() || ""; if (!title || !content) return Response.json({ error: "标题和正文不能为空。" }, { status: 400 });
  const state = await readWorkspaceState(); ensureWorkspaceRecordSchema(state); ensureKnowledgeSchema(state); const group = body.group?.trim() || (other ? "其它资料" : "通用资料"); const category = getKnowledgeCategory(spaceId, group); if (!category) return Response.json({ error: "所选资料分类已不存在，请重新选择。" }, { status: 400 });
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
    .run(id, spaceId, category.id, title, `doc-${id}`, content, JSON.stringify(body.items || []), status, treeIcon, treeIconColor, access.user.name, access.user.name, now, now, spaceId, category.id);
  syncDocumentAssets(id, attachments.map((item) => item.id), content);
  syncDocumentCollaborators(id, body.collaborators || [], access.user.name);
  const storedAttachments = getDocumentAttachments(id);
  audit({ id: access.user.id, name: access.user.name }, "create", "doc", id, `${other ? "其它资料" : "通用资料"} / ${title}`);
  return Response.json({ doc: { id, categoryId: category.id, group, title, owner: access.user.name, body: content, items: body.items || [], updatedAt: now, attachments: storedAttachments, collaborators: getDocumentCollaborators(id), version: 1, status, treeIcon, treeIconColor } }, { status: 201 });
}
