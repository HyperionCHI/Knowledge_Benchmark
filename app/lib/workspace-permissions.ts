import type { WorkspaceScopeGrant, WorkspaceState, WorkspaceUser } from "../../db/workspace";

export type WorkspacePermission = "none" | "view" | "edit";

function grantFor(profile: WorkspaceUser, scopeType: WorkspaceScopeGrant["scopeType"], scopeId: string) {
  return profile.grants?.find((grant) => grant.scopeType === scopeType && grant.scopeId === scopeId)?.permission;
}

export function resolveWorkspacePermission(state: WorkspaceState, profile: WorkspaceUser, brand: string, product?: string): WorkspacePermission {
  if (profile.role === "admin") return "edit";
  if (product) {
    const productId = state.productIds[`${brand}/${product}`];
    const productPermission = productId ? grantFor(profile, "product", productId) : undefined;
    if (productPermission) return productPermission;
  }
  const brandId = state.brandIds[brand];
  const brandPermission = brandId ? grantFor(profile, "brand", brandId) : undefined;
  if (brandPermission) return brandPermission;
  const allPermission = grantFor(profile, "all", "*");
  return allPermission || "none";
}

export function canViewWorkspaceScope(state: WorkspaceState, profile: WorkspaceUser, brand: string, product?: string) {
  if (product) return resolveWorkspacePermission(state, profile, brand, product) !== "none";
  if (resolveWorkspacePermission(state, profile, brand) !== "none") return true;
  return (state.productsByBrand[brand] || []).some((item) => resolveWorkspacePermission(state, profile, brand, item) !== "none");
}

export function canEditWorkspaceScope(state: WorkspaceState, profile: WorkspaceUser, brand: string, product: string) {
  return resolveWorkspacePermission(state, profile, brand, product) === "edit";
}

export function canEditGeneralContent(profile: WorkspaceUser) {
  return profile.role === "admin" || profile.generalPermission === "edit";
}

export function hasAnyWorkspaceEdit(profile: WorkspaceUser) {
  return profile.role === "admin" || Boolean(profile.grants?.some((grant) => grant.permission === "edit"));
}
