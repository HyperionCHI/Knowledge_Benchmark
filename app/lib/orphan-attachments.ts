import { ensureWorkspaceAssetSchema, type WorkspaceAttachmentRow } from "../../db/workspace-assets";
import { readWorkspaceState } from "../../db/workspace";
import { ensureWorkspaceRecordSchema } from "../../db/workspace-records";
import { sqlite } from "../../db/local";

export async function scanOrphanAttachments() {
  const state = await readWorkspaceState();
  ensureWorkspaceRecordSchema(state);
  await ensureWorkspaceAssetSchema();
  const rows = sqlite.prepare("SELECT * FROM workspace_attachments WHERE created_at < ? ORDER BY created_at").all(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) as WorkspaceAttachmentRow[];
  const linkedIds = new Set((sqlite.prepare(`SELECT DISTINCT da.attachment_id AS id FROM knowledge_document_assets da
    JOIN knowledge_documents d ON d.id = da.document_id WHERE d.deleted_at IS NULL`).all() as Array<{ id: string }>).map((row) => row.id));
  const iconReferences = JSON.stringify([
    ...Object.values(state.brandIcons || {}),
    ...Object.values(state.productIcons || {}),
  ]);
  const templateIds = new Set((sqlite.prepare("SELECT attachment_id AS id FROM product_templates WHERE attachment_id IS NOT NULL").all() as Array<{ id: string }>).map((row) => row.id));
  const deletedDocumentIds = new Set((sqlite.prepare(`SELECT DISTINCT da.attachment_id AS id FROM knowledge_document_assets da
    JOIN knowledge_documents d ON d.id = da.document_id WHERE d.deleted_at IS NOT NULL`).all() as Array<{ id: string }>).map((row) => row.id));
  return rows.filter((row) => {
    if (templateIds.has(row.id) || linkedIds.has(row.id) || iconReferences.includes(`/api/workspace-attachments/${row.id}`)) return false;
    const documentLibraryResource = row.scope === "doc" || row.scope === "other-doc" || row.scope === "sop";
    return !documentLibraryResource || deletedDocumentIds.has(row.id);
  });
}
