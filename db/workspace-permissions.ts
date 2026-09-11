import { sqlite } from "./local";
import type { WorkspaceScopeGrant, WorkspaceState, WorkspaceUser } from "./workspace";

type PermissionRow = { scope_type: WorkspaceScopeGrant["scopeType"]; scope_id: string; permission: WorkspaceScopeGrant["permission"] };
type GeneralRow = { permission: "view" | "edit" };

function legacyGrant(state: WorkspaceState, scope: string, permission: "view" | "edit"): WorkspaceScopeGrant | null {
  if (scope === "*") return { scopeType: "all", scopeId: "*", permission };
  if (scope.startsWith("brand:") && Object.values(state.brandIds).includes(scope.slice(6))) return { scopeType: "brand", scopeId: scope.slice(6), permission };
  if (scope.startsWith("product:") && Object.values(state.productIds).includes(scope.slice(8))) return { scopeType: "product", scopeId: scope.slice(8), permission };
  const brand = state.brands.find((item) => item === scope);
  if (brand) return { scopeType: "brand", scopeId: state.brandIds[brand], permission };
  for (const candidate of state.brands) {
    const product = (state.productsByBrand[candidate] || []).find((item) => `${candidate} / ${item}` === scope);
    if (product) return { scopeType: "product", scopeId: state.productIds[`${candidate}/${product}`], permission };
  }
  return null;
}

export function grantsFromLegacyScopes(state: WorkspaceState, scopes: string[], permission: "view" | "edit") {
  const unique = new Map<string, WorkspaceScopeGrant>();
  for (const scope of scopes) {
    const grant = legacyGrant(state, scope, permission);
    if (grant) unique.set(`${grant.scopeType}:${grant.scopeId}`, grant);
  }
  return [...unique.values()];
}

export function ensureWorkspacePermissionSchema(state: WorkspaceState) {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS workspace_scope_permissions (
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('all', 'brand', 'product')),
      scope_id TEXT NOT NULL,
      permission TEXT NOT NULL CHECK(permission IN ('none', 'view', 'edit')),
      created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, scope_type, scope_id)
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_scope_permissions_user ON workspace_scope_permissions (user_id, permission);
    CREATE TABLE IF NOT EXISTS workspace_general_permissions (
      user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      permission TEXT NOT NULL DEFAULT 'view' CHECK(permission IN ('view', 'edit')),
      created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_permission_migrations (key TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);`);
  const migrationKey = "roles-and-scopes-to-permission-grants-v1";
  if (sqlite.prepare("SELECT 1 FROM workspace_permission_migrations WHERE key = ?").get(migrationKey)) return;
  const now = new Date().toISOString();
  sqlite.transaction(() => {
    for (const profile of state.users) {
      if (profile.role === "admin") continue;
      if (!sqlite.prepare("SELECT 1 FROM user WHERE id = ?").get(profile.id)) continue;
      const permission = profile.role === "editor" ? "edit" : "view";
      sqlite.prepare(`INSERT OR IGNORE INTO workspace_general_permissions (user_id, permission, created_by, created_at, updated_at) VALUES (?, ?, 'system-migration', ?, ?)`)
        .run(profile.id, permission, now, now);
      for (const grant of grantsFromLegacyScopes(state, profile.scopes || ["*"], permission)) sqlite.prepare(`INSERT OR IGNORE INTO workspace_scope_permissions (user_id, scope_type, scope_id, permission, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'system-migration', ?, ?)`)
        .run(profile.id, grant.scopeType, grant.scopeId, grant.permission, now, now);
    }
    sqlite.prepare("UPDATE user SET role = 'viewer' WHERE role = 'editor'").run();
    sqlite.prepare("INSERT INTO workspace_permission_migrations (key, applied_at) VALUES (?, ?)").run(migrationKey, now);
  })();
}

export function readWorkspaceUserPermissions(state: WorkspaceState, profile: WorkspaceUser) {
  ensureWorkspacePermissionSchema(state);
  if (profile.role === "admin") return { generalPermission: "edit" as const, grants: [] as WorkspaceScopeGrant[] };
  const general = sqlite.prepare("SELECT permission FROM workspace_general_permissions WHERE user_id = ?").get(profile.id) as GeneralRow | undefined;
  const rows = sqlite.prepare("SELECT scope_type, scope_id, permission FROM workspace_scope_permissions WHERE user_id = ? ORDER BY scope_type, scope_id").all(profile.id) as PermissionRow[];
  return {
    generalPermission: general?.permission || "view",
    grants: rows.map((row) => ({ scopeType: row.scope_type, scopeId: row.scope_id, permission: row.permission })),
  };
}

export function replaceWorkspaceUserPermissions(
  state: WorkspaceState,
  userId: string,
  generalPermission: "view" | "edit",
  grants: WorkspaceScopeGrant[],
  actorId: string,
) {
  ensureWorkspacePermissionSchema(state);
  const validBrands = new Set(Object.values(state.brandIds));
  const validProducts = new Set(Object.values(state.productIds));
  const normalized = new Map<string, WorkspaceScopeGrant>();
  for (const grant of grants) {
    if (!(["all", "brand", "product"] as const).includes(grant.scopeType) || !(["none", "view", "edit"] as const).includes(grant.permission)) continue;
    const valid = grant.scopeType === "all" ? grant.scopeId === "*" : grant.scopeType === "brand" ? validBrands.has(grant.scopeId) : validProducts.has(grant.scopeId);
    if (valid) normalized.set(`${grant.scopeType}:${grant.scopeId}`, grant);
  }
  const now = new Date().toISOString();
  sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM workspace_scope_permissions WHERE user_id = ?").run(userId);
    sqlite.prepare(`INSERT INTO workspace_general_permissions (user_id, permission, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET permission = excluded.permission, created_by = excluded.created_by, updated_at = excluded.updated_at`)
      .run(userId, generalPermission, actorId, now, now);
    for (const grant of normalized.values()) sqlite.prepare(`INSERT INTO workspace_scope_permissions (user_id, scope_type, scope_id, permission, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, grant.scopeType, grant.scopeId, grant.permission, actorId, now, now);
  })();
}
