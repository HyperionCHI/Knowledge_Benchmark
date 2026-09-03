import {
  GENERAL_KNOWLEDGE_SPACE_ID,
  OTHER_KNOWLEDGE_SPACE_ID,
  getKnowledgeDocument,
  type KnowledgeDocumentRow,
} from "../../db/knowledge";
import type { WorkspaceState, WorkspaceUser } from "../../db/workspace";
import { knowledgeDocumentPermission } from "./knowledge-permissions";

export type KnowledgeAttachmentScope = "doc" | "other-doc" | "sop";

type AttachmentOwner = {
  scope: string;
  brand: string;
  product: string;
  document_id: string;
};

type AttachmentTarget = Pick<AttachmentOwner, "scope" | "brand" | "product">;

export function isKnowledgeAttachmentScope(scope: string): scope is KnowledgeAttachmentScope {
  return scope === "doc" || scope === "other-doc" || scope === "sop";
}

export function matchesKnowledgeDocumentScope(
  scope: string,
  document: KnowledgeDocumentRow,
  productId?: string,
) {
  if (scope === "doc") return document.space_id === GENERAL_KNOWLEDGE_SPACE_ID;
  if (scope === "other-doc") return document.space_id === OTHER_KNOWLEDGE_SPACE_ID;
  return scope === "sop" && document.space_kind === "sop" && Boolean(productId) && document.product_id === productId;
}

export function matchesOwnedKnowledgeDocument(
  attachment: AttachmentOwner,
  document: KnowledgeDocumentRow,
  productId?: string,
) {
  return Boolean(attachment.document_id)
    && attachment.document_id === document.id
    && matchesKnowledgeDocumentScope(attachment.scope, document, productId);
}

export function resolveKnowledgeAttachmentAccess(
  state: WorkspaceState,
  profile: WorkspaceUser,
  target: AttachmentTarget,
  documentId: string,
) {
  const document = documentId ? getKnowledgeDocument(documentId) : null;
  const productId = target.scope === "sop" ? state.productIds[`${target.brand}/${target.product}`] : undefined;
  if (!document || document.deleted_at || !matchesKnowledgeDocumentScope(target.scope, document, productId)) return null;
  return { document, ...knowledgeDocumentPermission(state, profile, document) };
}

export function resolveOwnedKnowledgeAttachmentAccess(
  state: WorkspaceState,
  profile: WorkspaceUser,
  attachment: AttachmentOwner,
  documentId = attachment.document_id,
) {
  if (!attachment.document_id || attachment.document_id !== documentId) return null;
  return resolveKnowledgeAttachmentAccess(state, profile, attachment, documentId);
}
