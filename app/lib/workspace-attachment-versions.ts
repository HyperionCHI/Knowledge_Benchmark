import { getWorkspaceAssetBindings, type WorkspaceAttachmentRow } from "../../db/workspace-assets";
import { safeAttachmentName } from "./file-policy";

type AttachmentMetadata = {
  title: string;
  summary: string;
  content: string;
};

export async function createWorkspaceAttachmentVersion(
  attachment: WorkspaceAttachmentRow,
  file: File,
  actorName: string,
  metadata?: AttachmentMetadata,
) {
  const { DB, ATTACHMENTS } = getWorkspaceAssetBindings();
  const current = await DB.prepare("SELECT COALESCE(MAX(version), 0) AS value FROM workspace_attachment_versions WHERE attachment_id = ?").bind(attachment.id).first<{ value: number }>();
  const version = Number(current?.value || 0) + 1;
  const contentType = file.type || "application/octet-stream";
  const storageKey = `workspace/${attachment.scope}/${attachment.id}/versions/v${version}-${safeAttachmentName(file.name)}`;
  const now = new Date().toISOString();

  await ATTACHMENTS.put(storageKey, file.stream(), {
    httpMetadata: { contentType },
    customMetadata: { originalName: file.name, version: String(version) },
  });
  try {
    const update = metadata
      ? DB.prepare(`UPDATE workspace_attachments SET title = ?, summary = ?, content = ?, name = ?, content_type = ?, size = ?, storage_key = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
        .bind(metadata.title, metadata.summary, metadata.content, file.name, contentType, file.size, storageKey, actorName, now, attachment.id)
      : DB.prepare("UPDATE workspace_attachments SET name = ?, content_type = ?, size = ?, storage_key = ?, updated_by = ?, updated_at = ? WHERE id = ?")
        .bind(file.name, contentType, file.size, storageKey, actorName, now, attachment.id);
    await DB.batch([
      DB.prepare(`INSERT INTO workspace_attachment_versions (id, attachment_id, version, name, content_type, size, storage_key, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), attachment.id, version, file.name, contentType, file.size, storageKey, actorName, now),
      update,
    ]);
  } catch (error) {
    try { await ATTACHMENTS.delete(storageKey); } catch { /* best effort */ }
    throw error;
  }

  const row = await DB.prepare(`SELECT a.*, (SELECT MAX(version) FROM workspace_attachment_versions v WHERE v.attachment_id = a.id) AS version
    FROM workspace_attachments a WHERE a.id = ?`).bind(attachment.id).first<WorkspaceAttachmentRow & { version: number }>();
  return { row, version };
}
