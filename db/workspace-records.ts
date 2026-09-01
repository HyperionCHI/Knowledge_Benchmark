import { sqlite } from "./local";
import type { WorkspaceState } from "./workspace";
import { ensureKnowledgeSchema, readKnowledgeRecords } from "./knowledge";

type LinkRow = { id: string; brand_id: string; product_id: string; name: string; url: string; cycle: string; platform: string; note: string; color: string; created_by: string; updated_by: string; created_at: string; updated_at: string; version: number; sort_order: number };

export function ensureWorkspaceRecordSchema(seed?: WorkspaceState) {
  (sqlite as unknown as { exec: (sql: string) => void }).exec(`CREATE TABLE IF NOT EXISTS workspace_record_migrations (key TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace_docs (
      id TEXT PRIMARY KEY NOT NULL, group_name TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, items_json TEXT NOT NULL DEFAULT '[]', attachment_json TEXT,
      created_by TEXT NOT NULL, updated_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_docs_active_sort ON workspace_docs (deleted_at, sort_order, updated_at);
    CREATE TABLE IF NOT EXISTS workspace_sops (
      id TEXT PRIMARY KEY NOT NULL, brand_id TEXT NOT NULL, product_id TEXT NOT NULL UNIQUE, content TEXT NOT NULL,
      created_by TEXT NOT NULL, updated_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_sops_product ON workspace_sops (product_id, deleted_at);
    CREATE TABLE IF NOT EXISTS tracker_links (
      id TEXT PRIMARY KEY NOT NULL, brand_id TEXT NOT NULL, product_id TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL, cycle TEXT NOT NULL, platform TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', color TEXT NOT NULL,
      created_by TEXT NOT NULL, updated_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tracker_links_target_sort ON tracker_links (product_id, cycle, deleted_at, sort_order);
    CREATE TABLE IF NOT EXISTS content_versions (
      id TEXT PRIMARY KEY NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_content_versions_entity ON content_versions (entity_type, entity_id, version DESC);
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);`);
  if (seed && !sqlite.prepare("SELECT 1 FROM workspace_record_migrations WHERE key = 'seed-core-records-v1'").get()) {
    const now = new Date().toISOString();
    sqlite.transaction(() => {
      seed.docs.forEach((doc, index) => { const attachments = doc.attachments?.length ? doc.attachments : doc.attachment ? [doc.attachment] : []; sqlite.prepare(`INSERT OR IGNORE INTO workspace_docs (id, group_name, title, body, items_json, attachment_json, created_by, updated_by, created_at, updated_at, version, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(doc.id, doc.group, doc.title, doc.body, JSON.stringify(doc.items), attachments.length ? JSON.stringify(attachments) : null, doc.owner, doc.owner, doc.updatedAt, doc.updatedAt, index); });
      seed.sops.forEach((sop) => { const brandId = seed.brandIds[sop.brand], productId = seed.productIds[`${sop.brand}/${sop.product}`]; if (brandId && productId) sqlite.prepare(`INSERT OR IGNORE INTO workspace_sops (id, brand_id, product_id, content, created_by, updated_by, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(crypto.randomUUID(), brandId, productId, sop.content, sop.updatedBy, sop.updatedBy, sop.updatedAt, sop.updatedAt); });
      seed.links.forEach((link, index) => { const brandId = seed.brandIds[link.brand], productId = seed.productIds[`${link.brand}/${link.product}`]; if (brandId && productId) sqlite.prepare(`INSERT OR IGNORE INTO tracker_links (id, brand_id, product_id, name, url, cycle, platform, note, color, created_by, updated_by, created_at, updated_at, version, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(link.id, brandId, productId, link.name, link.url, link.cycle, link.platform, link.note, link.color, "系统迁移", "系统迁移", link.createdAt, link.createdAt, index); });
      sqlite.prepare("INSERT INTO workspace_record_migrations (key, applied_at) VALUES ('seed-core-records-v1', ?)").run(now);
    })();
  }
  ensureKnowledgeSchema(seed || ({
    docCategories: [], docCategoryRecords: [], otherDocCategories: ["其它资料"], otherDocCategoryRecords: [], brands: [], products: [], productsByBrand: {}, brandIds: {}, productIds: {}, brandIcons: {}, productIcons: {}, links: [], sops: [], sopCategories: [], docs: [], otherDocs: [], users: [],
  } satisfies WorkspaceState));
}

function targetNames(state: WorkspaceState, brandId: string, productId: string) {
  const brand = state.brands.find((item) => state.brandIds[item] === brandId) || "";
  const product = (state.productsByBrand[brand] || []).find((item) => state.productIds[`${brand}/${item}`] === productId) || "";
  return { brand, product };
}

export function readWorkspaceRecords(state: WorkspaceState) {
  ensureWorkspaceRecordSchema(state);
  const knowledge = readKnowledgeRecords(state);
  const links = (sqlite.prepare("SELECT * FROM tracker_links WHERE deleted_at IS NULL ORDER BY product_id, cycle, sort_order, created_at").all() as LinkRow[]).flatMap((row) => { const target = targetNames(state, row.brand_id, row.product_id); return target.brand && target.product ? [{ id: row.id, ...target, name: row.name, url: row.url, cycle: row.cycle, platform: row.platform, note: row.note, color: row.color, createdAt: row.created_at, updatedBy: row.updated_by, updatedAt: row.updated_at, version: row.version, sortOrder: row.sort_order }] : []; });
  return { ...knowledge, links };
}

export function resolveProductIds(state: WorkspaceState, brand: string, product: string) {
  const brandId = state.brandIds[brand], productId = state.productIds[`${brand}/${product}`];
  return brandId && productId ? { brandId, productId } : null;
}

export function resolveProductNames(state: WorkspaceState, productId: string) {
  for (const brand of state.brands) for (const product of state.productsByBrand[brand] || []) if (state.productIds[`${brand}/${product}`] === productId) return { brand, product, brandId: state.brandIds[brand] };
  return null;
}

export function audit(actor: { id: string; name: string }, action: string, entityType: string, entityId: string, detail = "") {
  sqlite.prepare("INSERT INTO audit_logs (id, actor_id, actor_name, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(crypto.randomUUID(), actor.id, actor.name, action, entityType, entityId, detail, new Date().toISOString());
}

export function snapshotVersion(entityType: string, entityId: string, version: number, payload: unknown, actorName: string) {
  sqlite.prepare("INSERT INTO content_versions (id, entity_type, entity_id, version, payload, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(crypto.randomUUID(), entityType, entityId, version, JSON.stringify(payload), actorName, new Date().toISOString());
}
