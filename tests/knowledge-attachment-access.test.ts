import assert from "node:assert/strict";
import test from "node:test";
import {
  isKnowledgeAttachmentScope,
  matchesKnowledgeDocumentScope,
  matchesOwnedKnowledgeDocument,
} from "../app/lib/knowledge-attachment-access";
import type { KnowledgeDocumentRow } from "../db/knowledge";

function document(overrides: Partial<KnowledgeDocumentRow> = {}): KnowledgeDocumentRow {
  return {
    id: "document-general",
    space_id: "knowledge-general",
    category_id: "category",
    category_name: "分类",
    space_kind: "general",
    brand_id: null,
    product_id: null,
    title: "测试文章",
    slug: "test-document",
    body: "# 测试",
    items_json: "[]",
    status: "published",
    tree_icon: "docs",
    tree_icon_color: "#2859e8",
    created_by: "QA",
    updated_by: "QA",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    version: 1,
    sort_order: 0,
    deleted_at: null,
    ...overrides,
  };
}

test("recognizes only article attachment scopes", () => {
  assert.equal(isKnowledgeAttachmentScope("doc"), true);
  assert.equal(isKnowledgeAttachmentScope("other-doc"), true);
  assert.equal(isKnowledgeAttachmentScope("sop"), true);
  assert.equal(isKnowledgeAttachmentScope("catalog-icon"), false);
  assert.equal(isKnowledgeAttachmentScope(""), false);
});

test("matches general, other and SOP documents to their exact scopes", () => {
  const general = document();
  const other = document({ id: "document-other", space_id: "knowledge-other" });
  const sop = document({ id: "document-sop", space_id: "knowledge-sop-product", space_kind: "sop", product_id: "product-1" });

  assert.equal(matchesKnowledgeDocumentScope("doc", general), true);
  assert.equal(matchesKnowledgeDocumentScope("other-doc", general), false);
  assert.equal(matchesKnowledgeDocumentScope("other-doc", other), true);
  assert.equal(matchesKnowledgeDocumentScope("sop", sop, "product-1"), true);
  assert.equal(matchesKnowledgeDocumentScope("sop", sop, "product-2"), false);
  assert.equal(matchesKnowledgeDocumentScope("sop", sop), false);
});

test("requires the attachment to belong to the exact document", () => {
  const general = document();
  assert.equal(matchesOwnedKnowledgeDocument({ scope: "doc", brand: "", product: "", document_id: general.id }, general), true);
  assert.equal(matchesOwnedKnowledgeDocument({ scope: "doc", brand: "", product: "", document_id: "another-document" }, general), false);
  assert.equal(matchesOwnedKnowledgeDocument({ scope: "doc", brand: "", product: "", document_id: "" }, general), false);
  assert.equal(matchesOwnedKnowledgeDocument({ scope: "other-doc", brand: "", product: "", document_id: general.id }, general), false);
});
