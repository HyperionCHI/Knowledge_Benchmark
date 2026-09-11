import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceState, WorkspaceUser } from "../db/workspace";
import { canEditGeneralContent, canEditWorkspaceScope, canViewWorkspaceScope, resolveWorkspacePermission } from "../app/lib/workspace-permissions";

const state = {
  brands: ["品牌 A", "品牌 B"],
  productsByBrand: { "品牌 A": ["产品 1", "产品 2"], "品牌 B": ["产品 1"] },
  brandIds: { "品牌 A": "brand-a", "品牌 B": "brand-b" },
  productIds: { "品牌 A/产品 1": "product-a1", "品牌 A/产品 2": "product-a2", "品牌 B/产品 1": "product-b1" },
} as WorkspaceState;

const member = {
  id: "member-1", name: "混合权限成员", email: "member@example.test", role: "viewer", scopes: [], generalPermission: "view",
  grants: [
    { scopeType: "all", scopeId: "*", permission: "view" },
    { scopeType: "brand", scopeId: "brand-a", permission: "edit" },
    { scopeType: "product", scopeId: "product-a2", permission: "none" },
    { scopeType: "product", scopeId: "product-b1", permission: "edit" },
  ],
} satisfies WorkspaceUser;

test("product permission overrides brand and all-product grants", () => {
  assert.equal(resolveWorkspacePermission(state, member, "品牌 A", "产品 1"), "edit");
  assert.equal(resolveWorkspacePermission(state, member, "品牌 A", "产品 2"), "none");
  assert.equal(resolveWorkspacePermission(state, member, "品牌 B", "产品 1"), "edit");
  assert.equal(canEditWorkspaceScope(state, member, "品牌 A", "产品 1"), true);
  assert.equal(canViewWorkspaceScope(state, member, "品牌 A", "产品 2"), false);
});

test("brand remains visible when any child product is visible", () => {
  const productOnly = { ...member, grants: [{ scopeType: "product", scopeId: "product-a1", permission: "view" }] } satisfies WorkspaceUser;
  assert.equal(canViewWorkspaceScope(state, productOnly, "品牌 A"), true);
  assert.equal(canViewWorkspaceScope(state, productOnly, "品牌 B"), false);
});

test("general content permission is independent and admin remains unrestricted", () => {
  assert.equal(canEditGeneralContent(member), false);
  assert.equal(canEditGeneralContent({ ...member, generalPermission: "edit" }), true);
  const admin = { ...member, role: "admin", generalPermission: "view", grants: [] } satisfies WorkspaceUser;
  assert.equal(canEditGeneralContent(admin), true);
  assert.equal(resolveWorkspacePermission(state, admin, "品牌 A", "产品 2"), "edit");
});
