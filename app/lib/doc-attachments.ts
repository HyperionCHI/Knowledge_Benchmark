import {
  ensureWorkspaceAssetSchema,
  getWorkspaceAssetBindings,
  toWorkspaceAttachment,
  type WorkspaceAttachmentRow,
} from "../../db/workspace-assets";

export type StoredDocAttachment = ReturnType<typeof toWorkspaceAttachment>;

export function parseDocAttachments(value: string | null | undefined): StoredDocAttachment[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
    return values.filter((item): item is StoredDocAttachment => Boolean(item && typeof item === "object" && "id" in item && typeof (item as { id?: unknown }).id === "string"));
  } catch {
    return [];
  }
}

export async function resolveDocAttachments(value: unknown): Promise<StoredDocAttachment[]> {
  return resolveKnowledgeAttachments(value, ["doc"]);
}

export async function resolveKnowledgeAttachments(value: unknown, scopes: string[], documentId?: string): Promise<StoredDocAttachment[]> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error("资料附件数据无效，单篇资料最多添加 20 个附件。");
  const ids = [...new Set(value.map((item) => typeof item === "string" ? item : item && typeof item === "object" ? String((item as { id?: unknown }).id || "") : "").filter(Boolean))];
  if (ids.length !== value.length) throw new Error("资料附件数据无效。");
  await ensureWorkspaceAssetSchema();
  const { DB } = getWorkspaceAssetBindings();
  const rows: WorkspaceAttachmentRow[] = [];
  for (const id of ids) {
    const row = await DB.prepare("SELECT * FROM workspace_attachments WHERE id = ?").bind(id).first<WorkspaceAttachmentRow>();
    if (row && !scopes.includes(row.scope)) throw new Error("所选资料附件不属于当前资料库。");
    if (!row) throw new Error("所选资料附件不存在或已被删除。");
    if (documentId && row.document_id !== documentId) throw new Error("所选资料附件不属于当前文章。");
    if (!row.name.trim() || Number(row.size) <= 0) throw new Error("所选资料仅包含文本内容，不能作为文档附件引用。");
    rows.push(row);
  }
  return rows.map(toWorkspaceAttachment);
}

export async function deleteDocAttachments(attachments: StoredDocAttachment[]) {
  if (!attachments.length) return;
  await ensureWorkspaceAssetSchema();
  const { DB, ATTACHMENTS } = getWorkspaceAssetBindings();
  for (const attachment of attachments) {
    const row = await DB.prepare("SELECT * FROM workspace_attachments WHERE id = ? AND scope = 'doc'").bind(attachment.id).first<WorkspaceAttachmentRow>();
    if (!row) continue;
    await DB.prepare("DELETE FROM workspace_attachments WHERE id = ?").bind(row.id).run();
    try { await ATTACHMENTS.delete(row.storage_key); } catch { /* orphan cleanup can retry later */ }
  }
}
