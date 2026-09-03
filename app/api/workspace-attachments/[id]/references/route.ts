import { ensureWorkspaceAssetSchema, getWorkspaceAssetBindings, type WorkspaceAttachmentRow } from "../../../../../db/workspace-assets";
import { getWorkspaceAccess } from "../../../../lib/authorize";
import { ensureWorkspaceRecordSchema } from "../../../../../db/workspace-records";
import { ensureKnowledgeSchema } from "../../../../../db/knowledge";
import { resolveOwnedKnowledgeAttachmentAccess } from "../../../../lib/knowledge-attachment-access";

async function find(id: string) { await ensureWorkspaceAssetSchema(); return getWorkspaceAssetBindings().DB.prepare("SELECT * FROM workspace_attachments WHERE id = ?").bind(id).first<WorkspaceAttachmentRow>(); }

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await getWorkspaceAccess(request);
  if (access.denied || !access.profile) return access.denied;
  if (!access.state) return Response.json({ error: "工作台状态不可用。" }, { status: 500 });
  ensureWorkspaceRecordSchema(access.state); ensureKnowledgeSchema(access.state);
  const row = await find((await params).id);
  if (!row) return Response.json({ error: "附件不存在。" }, { status: 404 });
  const documentId = new URL(request.url).searchParams.get("documentId") || "";
  const documentAllowed = resolveOwnedKnowledgeAttachmentAccess(access.state, access.profile, row, documentId)?.canEdit ?? false;
  if (!documentAllowed) return Response.json({ error: "没有查看该资源引用情况的权限。" }, { status: 403 });
  const result = await getWorkspaceAssetBindings().DB.prepare(`SELECT d.id, d.title, d.status, d.updated_by, d.updated_at, c.name AS category, s.kind AS space_kind FROM knowledge_document_assets da JOIN knowledge_documents d ON d.id = da.document_id JOIN knowledge_categories c ON c.id = d.category_id JOIN knowledge_spaces s ON s.id = d.space_id WHERE da.attachment_id = ? AND d.deleted_at IS NULL ORDER BY d.updated_at DESC`).bind(row.id).all<{ id: string; title: string; status: string; updated_by: string; updated_at: string; category: string; space_kind: string }>();
  return Response.json({ references: result.results.map((item) => ({ id: item.id, title: item.title, category: item.category, spaceKind: item.space_kind, status: item.status, updatedBy: item.updated_by, updatedAt: item.updated_at })) });
}
