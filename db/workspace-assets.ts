import { attachments } from "./attachments";
import { getLocalDatabase } from "./local";

export type WorkspaceAttachmentRow = {
  id: string; scope: string; brand: string; product: string; document_id: string; title: string; summary: string; content: string;
  name: string; content_type: string; size: number; storage_key: string;
  created_by: string; created_at: string; updated_by: string; updated_at: string;
};

export type ProductTemplateRow = {
  id: string; brand: string; product: string; title: string; summary: string; content: string;
  attachment_id: string | null; attachment_name: string | null; attachment_size: number | null;
  created_by: string; updated_by: string; created_at: string; updated_at: string;
};

export function getWorkspaceAssetBindings() { return { DB: getLocalDatabase(), ATTACHMENTS: attachments }; }

export async function ensureWorkspaceAssetSchema() {
  const { DB } = getWorkspaceAssetBindings();
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS workspace_attachments (
      id TEXT PRIMARY KEY NOT NULL,
      scope TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT '',
      product TEXT NOT NULL DEFAULT '',
      document_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      content_type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      storage_key TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    )`),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_workspace_attachments_scope_target ON workspace_attachments (scope, brand, product)"),
    DB.prepare(`CREATE TABLE IF NOT EXISTS workspace_attachment_versions (
      id TEXT PRIMARY KEY NOT NULL, attachment_id TEXT NOT NULL REFERENCES workspace_attachments(id) ON DELETE CASCADE,
      version INTEGER NOT NULL, name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL,
      storage_key TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created_at TEXT NOT NULL
    )`),
    DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_attachment_versions_number ON workspace_attachment_versions (attachment_id, version)"),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_workspace_attachment_versions_attachment ON workspace_attachment_versions (attachment_id, created_at)"),
    DB.prepare(`CREATE TABLE IF NOT EXISTS workspace_inline_images (
      id TEXT PRIMARY KEY NOT NULL,
      scope TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT '',
      product TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      storage_key TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS product_templates (
      id TEXT PRIMARY KEY NOT NULL,
      brand TEXT NOT NULL,
      product TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      attachment_id TEXT REFERENCES workspace_attachments(id) ON DELETE SET NULL,
      attachment_name TEXT,
      attachment_size INTEGER,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_product_templates_target ON product_templates (brand, product, updated_at)"),
  ]);
  const columns = await DB.prepare("PRAGMA table_info(workspace_attachments)").all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "title")) await DB.prepare("ALTER TABLE workspace_attachments ADD COLUMN title TEXT NOT NULL DEFAULT ''").run();
  if (!columns.results.some((column) => column.name === "summary")) await DB.prepare("ALTER TABLE workspace_attachments ADD COLUMN summary TEXT NOT NULL DEFAULT ''").run();
  if (!columns.results.some((column) => column.name === "content")) await DB.prepare("ALTER TABLE workspace_attachments ADD COLUMN content TEXT NOT NULL DEFAULT ''").run();
  if (!columns.results.some((column) => column.name === "document_id")) await DB.prepare("ALTER TABLE workspace_attachments ADD COLUMN document_id TEXT NOT NULL DEFAULT ''").run();
  if (!columns.results.some((column) => column.name === "updated_by")) await DB.prepare("ALTER TABLE workspace_attachments ADD COLUMN updated_by TEXT NOT NULL DEFAULT ''").run();
  if (!columns.results.some((column) => column.name === "updated_at")) await DB.prepare("ALTER TABLE workspace_attachments ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''").run();
  await DB.prepare("UPDATE workspace_attachments SET title = name WHERE title = ''").run();
  await DB.prepare("UPDATE workspace_attachments SET updated_by = created_by WHERE updated_by = ''").run();
  await DB.prepare("UPDATE workspace_attachments SET updated_at = created_at WHERE updated_at = ''").run();
  await DB.prepare("CREATE INDEX IF NOT EXISTS idx_workspace_attachments_document ON workspace_attachments (document_id, scope, updated_at)").run();
  const hasKnowledgeAssets = await DB.prepare("SELECT 1 AS value FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_document_assets'").first<{ value: number }>();
  if (hasKnowledgeAssets) await DB.prepare(`UPDATE workspace_attachments SET document_id = (
    SELECT da.document_id FROM knowledge_document_assets da WHERE da.attachment_id = workspace_attachments.id
    ORDER BY CASE da.role WHEN 'attachment' THEN 0 ELSE 1 END, da.created_at, da.document_id LIMIT 1
  ) WHERE document_id = '' AND scope IN ('doc', 'other-doc', 'sop') AND EXISTS (
    SELECT 1 FROM knowledge_document_assets da WHERE da.attachment_id = workspace_attachments.id
  )`).run();
  await DB.prepare(`INSERT OR IGNORE INTO workspace_attachment_versions
    (id, attachment_id, version, name, content_type, size, storage_key, created_by, created_at)
    SELECT 'attachment-version-' || id, id, 1, name, content_type, size, storage_key, created_by, created_at
    FROM workspace_attachments WHERE name <> '' AND size > 0`).run();
}

export function toWorkspaceAttachment(row: WorkspaceAttachmentRow) {
  const attachmentName = row.name?.trim() || null;
  const hasAttachment = Boolean(attachmentName && Number(row.size) > 0);
  return {
    id: row.id,
    title: row.title?.trim() || attachmentName || "未命名资料",
    summary: row.summary || "",
    content: row.content || "",
    name: attachmentName || "",
    attachmentName,
    attachmentSize: hasAttachment ? Number(row.size) : null,
    type: hasAttachment ? row.content_type : "",
    size: hasAttachment ? Number(row.size) : 0,
    hasAttachment,
    scope: row.scope,
    brand: row.brand,
    product: row.product,
    documentId: row.document_id || "",
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by || row.created_by,
    updatedAt: row.updated_at || row.created_at,
    version: Number((row as WorkspaceAttachmentRow & { version?: number }).version || 1),
    url: hasAttachment ? `/api/workspace-attachments/${row.id}` : "",
  };
}

export function toProductTemplate(row: ProductTemplateRow) {
  return { id: row.id, brand: row.brand, product: row.product, title: row.title, summary: row.summary, content: row.content, attachmentId: row.attachment_id, attachmentName: row.attachment_name, attachmentSize: row.attachment_size, createdBy: row.created_by, updatedBy: row.updated_by, createdAt: row.created_at, updatedAt: row.updated_at };
}
