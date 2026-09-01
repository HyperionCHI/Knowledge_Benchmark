import type { WorkspaceState, WorkspaceUser } from "../../db/workspace";
import { getDocumentCollaboratorPermission, getDocumentCollaborators, type KnowledgeDocumentRow } from "../../db/knowledge";
import { isWorkspaceScopeAllowed } from "./workspace-scopes";

export function knowledgeDocumentPermission(state: WorkspaceState, profile: WorkspaceUser, document: KnowledgeDocumentRow) {
  if (profile.role === "admin") return { canView: true, canEdit: true, canManage: true };
  const collaborator = getDocumentCollaboratorPermission(document.id, profile.id);
  const collaborators = getDocumentCollaborators(document.id);
  const target = document.space_kind === "sop"
    ? state.brands.flatMap((brand) => (state.productsByBrand[brand] || []).map((product) => ({ brand, product, id: state.productIds[`${brand}/${product}`] }))).find((item) => item.id === document.product_id)
    : null;
  const scopeAllowed = document.space_kind === "general" || Boolean(target && isWorkspaceScopeAllowed(state, profile.scopes, target.brand, target.product));
  const fallbackEdit = profile.role === "editor" && scopeAllowed && collaborators.length === 0;
  const canEdit = scopeAllowed && (collaborator === "edit" || fallbackEdit);
  const canViewRestricted = scopeAllowed && (canEdit || collaborator === "view");
  const canView = scopeAllowed && (document.status === "published" || canViewRestricted);
  return { canView, canEdit, canManage: false };
}
