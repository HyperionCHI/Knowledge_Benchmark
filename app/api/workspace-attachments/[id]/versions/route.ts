import { ensureWorkspaceAssetSchema, getWorkspaceAssetBindings, toWorkspaceAttachment, type WorkspaceAttachmentRow } from "../../../../../db/workspace-assets";
import { getWorkspaceAccess } from "../../../../lib/authorize";
import { validateWorkspaceFile } from "../../../../lib/file-policy";
import { ensureWorkspaceRecordSchema } from "../../../../../db/workspace-records";
import { ensureKnowledgeSchema } from "../../../../../db/knowledge";
import { resolveOwnedKnowledgeAttachmentAccess } from "../../../../lib/knowledge-attachment-access";
import { createWorkspaceAttachmentVersion } from "../../../../lib/workspace-attachment-versions";

async function context(request: Request, id: string) {
  await ensureWorkspaceAssetSchema();
  const row = await getWorkspaceAssetBindings().DB.prepare("SELECT * FROM workspace_attachments WHERE id = ?").bind(id).first<WorkspaceAttachmentRow>();
  if (!row) return { denied: Response.json({ error: "附件不存在。" }, { status: 404 }), row: null, access: null };
  const access = await getWorkspaceAccess(request);
  if (access.denied || !access.profile || !access.session?.user) return { denied: access.denied, row: null, access: null };
  return { denied: null, row, access };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await context(request, (await params).id);
  if (result.denied || !result.row || !result.access?.profile || !result.access.state) return result.denied;
  ensureWorkspaceRecordSchema(result.access.state); ensureKnowledgeSchema(result.access.state);
  if (!resolveOwnedKnowledgeAttachmentAccess(result.access.state, result.access.profile, result.row)?.canView) return Response.json({ error: "没有该附件的访问权限。" }, { status: 403 });
  const versions = await getWorkspaceAssetBindings().DB.prepare(`SELECT id, version, name, content_type, size, created_by, created_at
    FROM workspace_attachment_versions WHERE attachment_id = ? ORDER BY version DESC`).bind(result.row.id).all<Record<string, unknown>>();
  return Response.json({ versions: versions.results });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const result = await context(request, (await params).id);
  if (result.denied || !result.row || !result.access?.profile || !result.access.session?.user) return result.denied;
  if (!result.access.state) return Response.json({ error: "工作台状态不可用。" }, { status: 500 });
  ensureWorkspaceRecordSchema(result.access.state); ensureKnowledgeSchema(result.access.state);
  let form: FormData; try { form = await request.formData(); } catch { return Response.json({ error: "资源版本表单无效。" }, { status: 400 }); }
  if (!resolveOwnedKnowledgeAttachmentAccess(result.access.state, result.access.profile, result.row)?.canEdit) return Response.json({ error: "没有该附件的版本更新权限。" }, { status: 403 });
  try {
    const value = form.get("file"), file = value instanceof File ? value : null;
    if (!file) return Response.json({ error: "请选择新版本文件。" }, { status: 400 });
    const invalid = validateWorkspaceFile(file); if (invalid) return Response.json({ error: invalid }, { status: 400 });
    const created = await createWorkspaceAttachmentVersion(result.row, file, result.access.session.user.name);
    return Response.json({ attachment: created.row ? toWorkspaceAttachment(created.row) : null, version: created.version });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "附件版本上传失败。" }, { status: 500 });
  }
}
