import type { WorkspaceState } from "./workspace";
import { sqlite } from "./local";
import { toWorkspaceAttachment, type WorkspaceAttachmentRow } from "./workspace-assets";

export const GENERAL_KNOWLEDGE_SPACE_ID = "knowledge-general";
export const OTHER_KNOWLEDGE_SPACE_ID = "knowledge-other";
export const DEFAULT_SOP_CATEGORY = "产品资料";

export type KnowledgeSpaceKind = "general" | "sop";

export type KnowledgeDocumentRow = {
  id: string;
  space_id: string;
  category_id: string;
  category_name: string;
  space_kind: KnowledgeSpaceKind;
  brand_id: string | null;
  product_id: string | null;
  title: string;
  slug: string;
  body: string;
  items_json: string;
  status: "draft" | "published" | "archived";
  tree_icon: string;
  tree_icon_color: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  version: number;
  sort_order: number;
  deleted_at: string | null;
};

export type KnowledgeCollaborator = { userId: string; name: string; email: string; permission: "view" | "edit" };

type LegacyDocRow = {
  id: string; group_name: string; title: string; body: string; items_json: string; attachment_json: string | null;
  created_by: string; updated_by: string; created_at: string; updated_at: string; version: number; sort_order: number; deleted_at: string | null;
};

type LegacySopRow = {
  id: string; brand_id: string; product_id: string; content: string; created_by: string; updated_by: string;
  created_at: string; updated_at: string; version: number; deleted_at: string | null;
};

function stableId(prefix: string, value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function parseAttachmentIds(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
    return values.map((item) => item && typeof item === "object" && "id" in item ? String((item as { id?: unknown }).id || "") : "").filter(Boolean);
  } catch { return []; }
}

function existingAttachmentIds(ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const exists = sqlite.prepare("SELECT 1 FROM workspace_attachments WHERE id = ? AND name <> '' AND size > 0");
  return uniqueIds.filter((id) => Boolean(exists.get(id)));
}

export function inlineAttachmentIds(markdown: string) {
  return [...markdown.matchAll(/\/api\/workspace-attachments\/([a-zA-Z0-9-]+)/g)].map((match) => match[1]);
}

function targetNames(state: WorkspaceState, brandId: string | null, productId: string | null) {
  if (!brandId || !productId) return { brand: "", product: "" };
  const brand = state.brands.find((item) => state.brandIds[item] === brandId) || "";
  const product = (state.productsByBrand[brand] || []).find((item) => state.productIds[`${brand}/${item}`] === productId) || "";
  return { brand, product };
}

export function ensureKnowledgeSchema(state: WorkspaceState) {
  (sqlite as unknown as { exec: (sql: string) => void }).exec(`
    CREATE TABLE IF NOT EXISTS workspace_attachments (
      id TEXT PRIMARY KEY NOT NULL, scope TEXT NOT NULL, brand TEXT NOT NULL DEFAULT '', product TEXT NOT NULL DEFAULT '', document_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '', content_type TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0,
      storage_key TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS knowledge_spaces (
      id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('general', 'sop')), brand_id TEXT, product_id TEXT,
      title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_spaces_kind_product ON knowledge_spaces (kind, product_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_spaces_brand ON knowledge_spaces (brand_id);
    CREATE TABLE IF NOT EXISTS knowledge_categories (
      id TEXT PRIMARY KEY NOT NULL, space_id TEXT NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
      parent_id TEXT, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_categories_space_name ON knowledge_categories (space_id, name);
    CREATE INDEX IF NOT EXISTS idx_knowledge_categories_space_sort ON knowledge_categories (space_id, sort_order);
    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id TEXT PRIMARY KEY NOT NULL, space_id TEXT NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES knowledge_categories(id) ON DELETE RESTRICT ON UPDATE CASCADE,
      title TEXT NOT NULL, slug TEXT NOT NULL, body TEXT NOT NULL, items_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
      tree_icon TEXT NOT NULL DEFAULT 'docs', tree_icon_color TEXT NOT NULL DEFAULT '#53617b',
      created_by TEXT NOT NULL, updated_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_documents_space_slug ON knowledge_documents (space_id, slug);
    CREATE INDEX IF NOT EXISTS idx_knowledge_documents_space_category_sort ON knowledge_documents (space_id, category_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_knowledge_documents_active_updated ON knowledge_documents (deleted_at, updated_at);
    CREATE TABLE IF NOT EXISTS knowledge_document_assets (
      document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
      attachment_id TEXT NOT NULL REFERENCES workspace_attachments(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'attachment' CHECK (role IN ('attachment', 'inline', 'cover', 'source')),
      sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
      PRIMARY KEY (document_id, attachment_id, role)
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_document_assets_attachment ON knowledge_document_assets (attachment_id);
    CREATE TABLE IF NOT EXISTS knowledge_document_collaborators (
      document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      permission TEXT NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit')),
      created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (document_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_collaborators_user ON knowledge_document_collaborators (user_id, permission);
    CREATE TABLE IF NOT EXISTS workspace_attachment_versions (
      id TEXT PRIMARY KEY NOT NULL,
      attachment_id TEXT NOT NULL REFERENCES workspace_attachments(id) ON DELETE CASCADE,
      version INTEGER NOT NULL, name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL,
      storage_key TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_attachment_versions_number ON workspace_attachment_versions (attachment_id, version);
    CREATE INDEX IF NOT EXISTS idx_workspace_attachment_versions_attachment ON workspace_attachment_versions (attachment_id, created_at);
  `);

  const attachmentColumns = sqlite.prepare("PRAGMA table_info(workspace_attachments)").all() as Array<{ name: string }>;
  if (!attachmentColumns.some((column) => column.name === "document_id")) sqlite.prepare("ALTER TABLE workspace_attachments ADD COLUMN document_id TEXT NOT NULL DEFAULT ''").run();
  sqlite.prepare("CREATE INDEX IF NOT EXISTS idx_workspace_attachments_document ON workspace_attachments (document_id, scope, updated_at)").run();

  const documentColumns = sqlite.prepare("PRAGMA table_info(knowledge_documents)").all() as Array<{ name: string }>;
  if (!documentColumns.some((column) => column.name === "tree_icon")) sqlite.prepare("ALTER TABLE knowledge_documents ADD COLUMN tree_icon TEXT NOT NULL DEFAULT 'docs'").run();
  if (!documentColumns.some((column) => column.name === "tree_icon_color")) sqlite.prepare("ALTER TABLE knowledge_documents ADD COLUMN tree_icon_color TEXT NOT NULL DEFAULT '#53617b'").run();
  sqlite.prepare(`UPDATE workspace_attachments SET document_id = (
    SELECT da.document_id FROM knowledge_document_assets da WHERE da.attachment_id = workspace_attachments.id
    ORDER BY CASE da.role WHEN 'attachment' THEN 0 ELSE 1 END, da.created_at, da.document_id LIMIT 1
  ) WHERE document_id = '' AND scope IN ('doc', 'other-doc', 'sop') AND EXISTS (
    SELECT 1 FROM knowledge_document_assets da WHERE da.attachment_id = workspace_attachments.id
  )`).run();

  sqlite.prepare(`INSERT OR IGNORE INTO workspace_attachment_versions
    (id, attachment_id, version, name, content_type, size, storage_key, created_by, created_at)
    SELECT 'attachment-version-' || id, id, 1, name, content_type, size, storage_key, created_by, created_at FROM workspace_attachments`).run();

  const now = new Date().toISOString();
  sqlite.prepare(`INSERT OR IGNORE INTO knowledge_spaces (id, kind, brand_id, product_id, title, created_at, updated_at)
    VALUES (?, 'general', NULL, NULL, '通用资料与规章制度', ?, ?)`).run(GENERAL_KNOWLEDGE_SPACE_ID, now, now);
  sqlite.prepare(`INSERT OR IGNORE INTO knowledge_spaces (id, kind, brand_id, product_id, title, created_at, updated_at)
    VALUES (?, 'general', NULL, NULL, '其它资料', ?, ?)`).run(OTHER_KNOWLEDGE_SPACE_ID, now, now);
  state.brands.forEach((brand) => {
    const brandId = state.brandIds[brand];
    (state.productsByBrand[brand] || []).forEach((product) => {
      const productId = state.productIds[`${brand}/${product}`];
      if (!brandId || !productId) return;
      const spaceId = `knowledge-sop-${productId}`;
      const existingSpace = sqlite.prepare("SELECT 1 FROM knowledge_spaces WHERE id = ?").get(spaceId);
      sqlite.prepare(`INSERT OR IGNORE INTO knowledge_spaces (id, kind, brand_id, product_id, title, created_at, updated_at)
        VALUES (?, 'sop', ?, ?, ?, ?, ?)`).run(spaceId, brandId, productId, `${brand} · ${product} SOP`, now, now);
      if (!existingSpace) sqlite.prepare(`INSERT INTO knowledge_categories (id, space_id, parent_id, name, sort_order, created_at, updated_at)
        VALUES (?, ?, NULL, ?, 0, ?, ?)`).run(stableId("knowledge-category", `${spaceId}:${DEFAULT_SOP_CATEGORY}`), spaceId, DEFAULT_SOP_CATEGORY, now, now);
    });
  });

  if (sqlite.prepare("SELECT 1 FROM workspace_record_migrations WHERE key = 'knowledge-spaces-v1'").get()) return;
  sqlite.transaction(() => {
    const otherGroups = state.otherDocCategories?.length ? state.otherDocCategories : ["其它资料"];
    otherGroups.forEach((name, index) => {
      sqlite.prepare(`INSERT OR IGNORE INTO knowledge_categories (id, space_id, parent_id, name, sort_order, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?, ?, ?)`).run(stableId("knowledge-category", `${OTHER_KNOWLEDGE_SPACE_ID}:${name}`), OTHER_KNOWLEDGE_SPACE_ID, name, index, now, now);
    });
    const groups = [...new Set([
      ...(state.docCategories || []),
      ...(sqlite.prepare("SELECT DISTINCT group_name FROM workspace_docs").all() as Array<{ group_name: string }>).map((row) => row.group_name),
    ])];
    groups.forEach((name, index) => {
      sqlite.prepare(`INSERT OR IGNORE INTO knowledge_categories (id, space_id, parent_id, name, sort_order, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?, ?, ?)`).run(stableId("knowledge-category", `${GENERAL_KNOWLEDGE_SPACE_ID}:${name}`), GENERAL_KNOWLEDGE_SPACE_ID, name, index, now, now);
    });

    const docs = sqlite.prepare("SELECT * FROM workspace_docs").all() as LegacyDocRow[];
    docs.forEach((doc) => {
      const categoryId = stableId("knowledge-category", `${GENERAL_KNOWLEDGE_SPACE_ID}:${doc.group_name}`);
      sqlite.prepare(`INSERT OR IGNORE INTO knowledge_documents (
        id, space_id, category_id, title, slug, body, items_json, status, created_by, updated_by, created_at, updated_at, version, sort_order, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?)`).run(
        doc.id, GENERAL_KNOWLEDGE_SPACE_ID, categoryId, doc.title, `doc-${doc.id}`, doc.body, doc.items_json,
        doc.created_by, doc.updated_by, doc.created_at, doc.updated_at, doc.version, doc.sort_order, doc.deleted_at,
      );
      const explicitIds = existingAttachmentIds(parseAttachmentIds(doc.attachment_json));
      explicitIds.forEach((attachmentId, index) => sqlite.prepare(`INSERT OR IGNORE INTO knowledge_document_assets
        (document_id, attachment_id, role, sort_order, created_at) VALUES (?, ?, 'attachment', ?, ?)`).run(doc.id, attachmentId, index, now));
      existingAttachmentIds(inlineAttachmentIds(doc.body)).forEach((attachmentId, index) => sqlite.prepare(`INSERT OR IGNORE INTO knowledge_document_assets
        (document_id, attachment_id, role, sort_order, created_at) VALUES (?, ?, 'inline', ?, ?)`).run(doc.id, attachmentId, index, now));
    });

    const sops = sqlite.prepare("SELECT * FROM workspace_sops").all() as LegacySopRow[];
    sops.forEach((sop) => {
      const names = targetNames(state, sop.brand_id, sop.product_id);
      const spaceId = `knowledge-sop-${sop.product_id}`;
      const categoryId = stableId("knowledge-category", `${spaceId}:${DEFAULT_SOP_CATEGORY}`);
      sqlite.prepare(`INSERT OR IGNORE INTO knowledge_documents (
        id, space_id, category_id, title, slug, body, items_json, status, created_by, updated_by, created_at, updated_at, version, sort_order, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, '[]', 'published', ?, ?, ?, ?, ?, 0, ?)`).run(
        sop.id, spaceId, categoryId, names.product ? `${names.product} SOP 总览` : "产品 SOP 总览", `sop-overview-${sop.id}`,
        sop.content, sop.created_by, sop.updated_by, sop.created_at, sop.updated_at, sop.version, sop.deleted_at,
      );
      existingAttachmentIds(inlineAttachmentIds(sop.content)).forEach((attachmentId, index) => sqlite.prepare(`INSERT OR IGNORE INTO knowledge_document_assets
        (document_id, attachment_id, role, sort_order, created_at) VALUES (?, ?, 'inline', ?, ?)`).run(sop.id, attachmentId, index, now));
    });
    sqlite.prepare("INSERT INTO workspace_record_migrations (key, applied_at) VALUES ('knowledge-spaces-v1', ?)").run(now);
  })();
}

export function getKnowledgeSpace(kind: KnowledgeSpaceKind, productId?: string) {
  return sqlite.prepare(`SELECT * FROM knowledge_spaces WHERE ${kind === "general" ? "id = ?" : "kind = ? AND product_id = ?"}`)
    .get(...(kind === "general" ? [GENERAL_KNOWLEDGE_SPACE_ID] : [kind, productId])) as { id: string; kind: KnowledgeSpaceKind; brand_id: string | null; product_id: string | null; title: string } | undefined;
}

export function getKnowledgeSpaceById(id: string) {
  return sqlite.prepare("SELECT * FROM knowledge_spaces WHERE id = ?").get(id) as { id: string; kind: KnowledgeSpaceKind; brand_id: string | null; product_id: string | null; title: string } | undefined;
}

export function getKnowledgeCategory(spaceId: string, name: string) {
  return sqlite.prepare("SELECT * FROM knowledge_categories WHERE space_id = ? AND name = ?").get(spaceId, name) as { id: string; space_id: string; name: string; sort_order: number } | undefined;
}

export function getKnowledgeDocument(id: string) {
  return sqlite.prepare(`SELECT d.*, c.name AS category_name, s.kind AS space_kind, s.brand_id, s.product_id
    FROM knowledge_documents d JOIN knowledge_categories c ON c.id = d.category_id JOIN knowledge_spaces s ON s.id = d.space_id
    WHERE d.id = ?`).get(id) as KnowledgeDocumentRow | undefined;
}

export function getDocumentAttachments(documentId: string, role: "attachment" | "inline" = "attachment") {
  const rows = sqlite.prepare(`SELECT a.*, COALESCE((SELECT MAX(version) FROM workspace_attachment_versions av WHERE av.attachment_id = a.id), 1) AS version FROM knowledge_document_assets da
    JOIN workspace_attachments a ON a.id = da.attachment_id
    WHERE da.document_id = ? AND da.role = ? ORDER BY da.sort_order, a.created_at`).all(documentId, role) as WorkspaceAttachmentRow[];
  return rows.map(toWorkspaceAttachment);
}

export function getDocumentCollaborators(documentId: string) {
  return sqlite.prepare(`SELECT c.user_id, c.permission, u.name, u.email
    FROM knowledge_document_collaborators c JOIN user u ON u.id = c.user_id
    WHERE c.document_id = ? ORDER BY CASE c.permission WHEN 'edit' THEN 0 ELSE 1 END, u.name`)
    .all(documentId).map((row) => {
      const value = row as { user_id: string; permission: "view" | "edit"; name: string; email: string };
      return { userId: value.user_id, permission: value.permission, name: value.name, email: value.email } satisfies KnowledgeCollaborator;
    });
}

export function getDocumentCollaboratorPermission(documentId: string, userId: string) {
  return (sqlite.prepare("SELECT permission FROM knowledge_document_collaborators WHERE document_id = ? AND user_id = ?")
    .get(documentId, userId) as { permission: "view" | "edit" } | undefined)?.permission || null;
}

export function syncDocumentCollaborators(documentId: string, collaborators: Array<{ userId: string; permission: "view" | "edit" }>, actor: string) {
  const now = new Date().toISOString();
  const validUsers = sqlite.prepare("SELECT 1 FROM user WHERE id = ?");
  const unique = new Map(collaborators.filter((item) => validUsers.get(item.userId)).map((item) => [item.userId, item.permission]));
  sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM knowledge_document_collaborators WHERE document_id = ?").run(documentId);
    unique.forEach((permission, userId) => sqlite.prepare(`INSERT INTO knowledge_document_collaborators
      (document_id, user_id, permission, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(documentId, userId, permission, actor, now, now));
  })();
}

export function syncDocumentAssets(documentId: string, explicitAttachmentIds: string[], markdown: string) {
  const now = new Date().toISOString();
  const attachmentIds = existingAttachmentIds(explicitAttachmentIds);
  const inlineIds = existingAttachmentIds(inlineAttachmentIds(markdown));
  sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM knowledge_document_assets WHERE document_id = ?").run(documentId);
    attachmentIds.forEach((attachmentId, index) => sqlite.prepare(`INSERT OR IGNORE INTO knowledge_document_assets
      (document_id, attachment_id, role, sort_order, created_at) VALUES (?, ?, 'attachment', ?, ?)`).run(documentId, attachmentId, index, now));
    inlineIds.forEach((attachmentId, index) => sqlite.prepare(`INSERT OR IGNORE INTO knowledge_document_assets
      (document_id, attachment_id, role, sort_order, created_at) VALUES (?, ?, 'inline', ?, ?)`).run(documentId, attachmentId, index, now));
  })();
}

export function readKnowledgeRecords(state: WorkspaceState) {
  ensureKnowledgeSchema(state);
  const categories = sqlite.prepare(`SELECT c.* FROM knowledge_categories c
    WHERE c.space_id = ? ORDER BY CASE WHEN c.parent_id IS NULL THEN 0 ELSE 1 END, c.sort_order, c.name`).all(GENERAL_KNOWLEDGE_SPACE_ID) as Array<{ id: string; name: string; parent_id: string | null; sort_order: number }>;
  const otherCategories = sqlite.prepare(`SELECT c.* FROM knowledge_categories c
    WHERE c.space_id = ? ORDER BY CASE WHEN c.parent_id IS NULL THEN 0 ELSE 1 END, c.sort_order, c.name`).all(OTHER_KNOWLEDGE_SPACE_ID) as Array<{ id: string; name: string; parent_id: string | null; sort_order: number }>;
  const rows = sqlite.prepare(`SELECT d.*, c.name AS category_name, s.kind AS space_kind, s.brand_id, s.product_id
    FROM knowledge_documents d JOIN knowledge_categories c ON c.id = d.category_id JOIN knowledge_spaces s ON s.id = d.space_id
    WHERE d.deleted_at IS NULL ORDER BY s.kind, s.product_id, c.sort_order, d.sort_order, d.updated_at DESC`).all() as KnowledgeDocumentRow[];

  const mapDoc = (row: KnowledgeDocumentRow) => ({
    id: row.id, categoryId: row.category_id, group: row.category_name, title: row.title, owner: row.updated_by, updatedAt: row.updated_at,
    body: row.body, items: JSON.parse(row.items_json) as string[], attachments: getDocumentAttachments(row.id), collaborators: getDocumentCollaborators(row.id), version: row.version, status: row.status, treeIcon: row.tree_icon, treeIconColor: row.tree_icon_color, sortOrder: row.sort_order,
  });
  const docs = rows.filter((row) => row.space_id === GENERAL_KNOWLEDGE_SPACE_ID).map(mapDoc);
  const otherDocs = rows.filter((row) => row.space_id === OTHER_KNOWLEDGE_SPACE_ID).map(mapDoc);
  const sops = rows.filter((row) => row.space_kind === "sop").flatMap((row) => {
    const target = targetNames(state, row.brand_id, row.product_id);
    return target.brand && target.product ? [{
      id: row.id, categoryId: row.category_id, ...target, group: row.category_name, title: row.title, content: row.body, items: JSON.parse(row.items_json) as string[],
      attachments: getDocumentAttachments(row.id), collaborators: getDocumentCollaborators(row.id), updatedBy: row.updated_by, updatedAt: row.updated_at, version: row.version, status: row.status, treeIcon: row.tree_icon, treeIconColor: row.tree_icon_color, sortOrder: row.sort_order,
    }] : [];
  });
  const sopCategories = (sqlite.prepare(`SELECT c.id, c.name, c.parent_id, c.sort_order, s.brand_id, s.product_id
    FROM knowledge_categories c JOIN knowledge_spaces s ON s.id = c.space_id
    WHERE s.kind = 'sop' ORDER BY s.product_id, CASE WHEN c.parent_id IS NULL THEN 0 ELSE 1 END, c.sort_order, c.name`).all() as Array<{ id: string; name: string; parent_id: string | null; sort_order: number; brand_id: string; product_id: string }>).flatMap((row) => {
      const target = targetNames(state, row.brand_id, row.product_id);
      return target.brand && target.product ? [{ id: row.id, ...target, name: row.name, parentId: row.parent_id, sortOrder: row.sort_order }] : [];
    });
  return {
    docCategories: categories.map((category) => category.name),
    docCategoryRecords: categories.map((category) => ({ id: category.id, name: category.name, parentId: category.parent_id, sortOrder: category.sort_order })),
    otherDocCategories: otherCategories.map((category) => category.name),
    otherDocCategoryRecords: otherCategories.map((category) => ({ id: category.id, name: category.name, parentId: category.parent_id, sortOrder: category.sort_order })),
    docs, otherDocs, sops, sopCategories,
  };
}
