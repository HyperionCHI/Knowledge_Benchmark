import { getLocalDatabase } from "./local";

export type WorkspaceUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "editor" | "viewer";
  scopes: string[];
};

export type WorkspaceState = {
  docCategories: string[];
  docCategoryRecords?: Array<{ id: string; name: string; parentId: string | null; sortOrder: number }>;
  otherDocCategories: string[];
  otherDocCategoryRecords?: Array<{ id: string; name: string; parentId: string | null; sortOrder: number }>;
  brands: string[];
  products: string[];
  productsByBrand: Record<string, string[]>;
  brandIds: Record<string, string>;
  productIds: Record<string, string>;
  brandIcons: Record<string, string>;
  productIcons: Record<string, string>;
  links: Array<{ id: string; brand: string; product: string; name: string; url: string; cycle: string; platform: string; note: string; color: string; createdAt: string }>;
  sops: Array<{ id?: string; categoryId?: string; brand: string; product: string; group?: string; title?: string; content: string; items?: string[]; attachments?: Array<{ id: string; name: string; type: string; size: number; url: string; version?: number }>; collaborators?: Array<{ userId: string; name: string; email: string; permission: "view" | "edit" }>; updatedBy: string; updatedAt: string; version?: number; status?: "draft" | "published" | "archived"; sortOrder?: number; canEdit?: boolean; canManage?: boolean }>;
  sopCategories: Array<{ id: string; brand: string; product: string; name: string; parentId: string | null; sortOrder: number }>;
  docs: Array<{ id: string; group: string; title: string; owner: string; updatedAt: string; body: string; items: string[]; attachments?: Array<{ id: string; name: string; type: string; size: number; url: string; version?: number }>; attachment?: { id: string; name: string; type: string; size: number; url: string; version?: number } | null; collaborators?: Array<{ userId: string; name: string; email: string; permission: "view" | "edit" }>; version?: number; status?: "draft" | "published" | "archived"; sortOrder?: number; canEdit?: boolean; canManage?: boolean }>;
  otherDocs: Array<{ id: string; group: string; title: string; owner: string; updatedAt: string; body: string; items: string[]; attachments?: Array<{ id: string; name: string; type: string; size: number; url: string; version?: number }>; attachment?: { id: string; name: string; type: string; size: number; url: string; version?: number } | null; collaborators?: Array<{ userId: string; name: string; email: string; permission: "view" | "edit" }>; version?: number; status?: "draft" | "published" | "archived"; sortOrder?: number; canEdit?: boolean; canManage?: boolean }>;
  users: WorkspaceUser[];
};

export class WorkspaceConflictError extends Error { constructor() { super("工作台数据已被其他成员更新，请刷新后重试。"); this.name = "WorkspaceConflictError"; } }

export const defaultWorkspaceState = {
  docCategories: ["通用资料", "操作指南"],
  docCategoryRecords: [],
  otherDocCategories: ["其它资料"],
  otherDocCategoryRecords: [],
  brands: [],
  products: [],
  productsByBrand: {},
  brandIds: {},
  productIds: {},
  brandIcons: {},
  productIcons: {},
  links: [],
  sops: [],
  sopCategories: [],
  docs: [],
  otherDocs: [],
  users: [] as WorkspaceUser[],
} satisfies WorkspaceState;

function getDb() {
  return getLocalDatabase();
}

function stableId(prefix: string, value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

export async function readWorkspaceState(): Promise<WorkspaceState> {
  return (await readWorkspaceSnapshot()).state;
}

export async function readWorkspaceSnapshot(): Promise<{ state: WorkspaceState; revision: number }> {
  const DB = getDb();
  await DB.prepare(`CREATE TABLE IF NOT EXISTS workspace_state (
    id TEXT PRIMARY KEY NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1
  )`).run();
  const columns = await DB.prepare("PRAGMA table_info(workspace_state)").all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "revision")) await DB.prepare("ALTER TABLE workspace_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 1").run();
  await DB.prepare(`CREATE TABLE IF NOT EXISTS workspace_state_migrations (
    key TEXT PRIMARY KEY NOT NULL,
    applied_at TEXT NOT NULL
  )`).run();
  const row = await DB.prepare("SELECT payload, revision FROM workspace_state WHERE id = ?").bind("main").first<{ payload: string; revision: number }>();
  if (!row) {
    const revision = await writeWorkspaceState(defaultWorkspaceState);
    return { state: structuredClone(defaultWorkspaceState), revision };
  }
  const raw = JSON.parse(row.payload) as Partial<WorkspaceState>;
  const brands = Array.isArray(raw.brands) ? raw.brands : defaultWorkspaceState.brands;
  const products = Array.isArray(raw.products) ? raw.products : defaultWorkspaceState.products;
  const productsByBrand = raw.productsByBrand || Object.fromEntries(brands.map((brand) => [brand, [...products]]));
  const brandIds = Object.fromEntries(brands.map((brand) => [brand, raw.brandIds?.[brand] || stableId("brand", brand)]));
  const productIds = Object.fromEntries(brands.flatMap((brand) => (productsByBrand[brand] || []).map((product) => {
    const key = `${brand}/${product}`;
    return [key, raw.productIds?.[key] || stableId("product", key)];
  })));
  const normalized: WorkspaceState = {
    ...structuredClone(defaultWorkspaceState),
    ...raw,
    brands,
    products,
    productsByBrand,
    brandIds,
    productIds,
    brandIcons: { ...defaultWorkspaceState.brandIcons, ...(raw.brandIcons || {}) },
    productIcons: raw.productIcons || {},
    docCategories: Array.isArray(raw.docCategories) && raw.docCategories.length
      ? [...new Set(raw.docCategories)]
      : [...new Set([...(defaultWorkspaceState.docCategories), ...(raw.docs || defaultWorkspaceState.docs).map((doc) => doc.group)])],
    users: Array.isArray(raw.users) ? raw.users : [],
  } as WorkspaceState;
  return { state: normalized, revision: Number(row.revision || 1) };
}

export async function writeWorkspaceState(state: WorkspaceState, expectedRevision?: number) {
  const payload = JSON.stringify(state);
  if (payload.length > 1_500_000) throw new Error("工作台数据体积超出限制。");
  const DB = getDb(); const now = new Date().toISOString();
  if (typeof expectedRevision === "number") {
    const result = await DB.prepare("UPDATE workspace_state SET payload = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?").bind(payload, now, "main", expectedRevision).run();
    if (!result.meta.changes) throw new WorkspaceConflictError();
    return expectedRevision + 1;
  }
  const current = await DB.prepare("SELECT revision FROM workspace_state WHERE id = ?").bind("main").first<{ revision: number }>(); const nextRevision = Number(current?.revision || 0) + 1;
  await DB.prepare(`INSERT INTO workspace_state (id, payload, updated_at, revision) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at, revision = excluded.revision`)
    .bind("main", payload, now, nextRevision).run();
  return nextRevision;
}
