import { getWorkspaceAccess } from "../../lib/authorize";
import { canViewWorkspaceScope } from "../../lib/workspace-permissions";
import { ensureTerminologySchema } from "../../../db/terminology";
import { ensureTemplateSchema } from "../../../db/templates";
import { ensureWorkspaceAssetSchema, type WorkspaceAttachmentRow } from "../../../db/workspace-assets";
import { ensureWorkspaceRecordSchema, resolveProductNames } from "../../../db/workspace-records";
import { sqlite } from "../../../db/local";
import { GENERAL_KNOWLEDGE_SPACE_ID, OTHER_KNOWLEDGE_SPACE_ID, getKnowledgeDocument } from "../../../db/knowledge";
import { knowledgeDocumentPermission } from "../../lib/knowledge-permissions";
import { resolveOwnedKnowledgeAttachmentAccess } from "../../lib/knowledge-attachment-access";

type SearchResultType = "文章" | "附件" | "术语";
type SearchResult = { type: SearchResultType; title: string; desc: string; view: string; entityId: string; brand?: string; product?: string; url?: string };
const allowed = (access: Awaited<ReturnType<typeof getWorkspaceAccess>>, brand: string, product: string) => !!access.profile && !!access.state && canViewWorkspaceScope(access.state, access.profile, brand, product);
const searchSections = {
  docs: "通用资料与规章制度",
  otherDocs: "其它资料",
  sop: "品牌 / 产品 SOP",
  tracker: "项目跟踪表格索引",
  terms: "行业术语库",
  templates: "通用附件及模板",
} as const;

function formatSearchResultTitle(section: string, fileName: string, brand?: string, product?: string) {
  return [section, brand, product, fileName].filter((value) => value?.trim()).join("-");
}

export async function GET(request: Request) {
  const access = await getWorkspaceAccess(request); if (access.denied || !access.profile || !access.state) return access.denied;
  const query = new URL(request.url).searchParams.get("q")?.trim() || ""; if (!query) return Response.json({ results: [] }); const pattern = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  await Promise.all([ensureTerminologySchema(), ensureTemplateSchema(), ensureWorkspaceAssetSchema()]); ensureWorkspaceRecordSchema(access.state);
  const results: SearchResult[] = [];
  const searchDocs = (spaceId: string) => sqlite.prepare(`SELECT d.id, d.title, d.body FROM knowledge_documents d JOIN knowledge_categories c ON c.id = d.category_id
    WHERE d.space_id = ? AND d.deleted_at IS NULL AND (d.title LIKE ? ESCAPE '\\' OR d.body LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\') ORDER BY d.updated_at DESC LIMIT 8`).all(spaceId, pattern, pattern, pattern) as Array<{ id: string; title: string; body: string }>;
  const docs = searchDocs(GENERAL_KNOWLEDGE_SPACE_ID);
  results.push(...docs.filter((row) => { const document = getKnowledgeDocument(row.id); return document && knowledgeDocumentPermission(access.state!, access.profile!, document).canView; }).map((row) => ({ type: "文章" as const, title: formatSearchResultTitle(searchSections.docs, row.title), desc: row.body.replace(/[#>*_`]/g, "").slice(0, 100), view: "docs", entityId: row.id })));
  const otherDocs = searchDocs(OTHER_KNOWLEDGE_SPACE_ID);
  results.push(...otherDocs.filter((row) => { const document = getKnowledgeDocument(row.id); return document && knowledgeDocumentPermission(access.state!, access.profile!, document).canView; }).map((row) => ({ type: "文章" as const, title: formatSearchResultTitle(searchSections.otherDocs, row.title), desc: row.body.replace(/[#>*_`]/g, "").slice(0, 100), view: "other-docs", entityId: row.id })));
  const sops = sqlite.prepare(`SELECT d.id, d.title, d.body AS content, s.product_id FROM knowledge_documents d JOIN knowledge_spaces s ON s.id = d.space_id JOIN knowledge_categories c ON c.id = d.category_id
    WHERE s.kind = 'sop' AND d.deleted_at IS NULL AND (d.title LIKE ? ESCAPE '\\' OR d.body LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\') ORDER BY d.updated_at DESC LIMIT 8`).all(pattern, pattern, pattern) as Array<{ id: string; title: string; product_id: string; content: string }>;
  for (const row of sops) { const target = resolveProductNames(access.state, row.product_id), document = getKnowledgeDocument(row.id); if (target && document && knowledgeDocumentPermission(access.state, access.profile, document).canView) results.push({ type: "文章", title: formatSearchResultTitle(searchSections.sop, row.title, target.brand, target.product), desc: row.content.replace(/[#>*_`]/g, "").slice(0, 100), view: "sop-detail", entityId: row.id, brand: target.brand, product: target.product }); }
  const articleAttachments = sqlite.prepare(`SELECT id, scope, brand, product, document_id, title, summary, content, name, content_type, size, storage_key, created_by, created_at, updated_by, updated_at
    FROM workspace_attachments WHERE scope IN ('doc', 'other-doc', 'sop') AND document_id <> '' AND name <> '' AND size > 0
      AND (name LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')
    ORDER BY updated_at DESC LIMIT 12`).all(pattern, pattern, pattern, pattern) as WorkspaceAttachmentRow[];
  for (const row of articleAttachments) {
    const attachmentAccess = resolveOwnedKnowledgeAttachmentAccess(access.state, access.profile, row);
    if (!attachmentAccess?.canView) continue;
    const { document } = attachmentAccess;
    let section: string, view: string, brand: string | undefined, product: string | undefined;
    if (row.scope === "doc" && document.space_id === GENERAL_KNOWLEDGE_SPACE_ID) { section = searchSections.docs; view = "docs"; }
    else if (row.scope === "other-doc" && document.space_id === OTHER_KNOWLEDGE_SPACE_ID) { section = searchSections.otherDocs; view = "other-docs"; }
    else if (row.scope === "sop" && document.space_kind === "sop" && document.product_id) {
      const target = resolveProductNames(access.state, document.product_id);
      if (!target || row.brand !== target.brand || row.product !== target.product) continue;
      section = searchSections.sop; view = "sop-detail"; brand = target.brand; product = target.product;
    } else continue;
    const description = [row.title !== row.name ? row.title : "", row.summary, row.content].find((value) => value?.trim()) || row.name;
    results.push({ type: "附件", title: formatSearchResultTitle(section, row.name, brand, product), desc: description.replace(/[#>*_`]/g, "").slice(0, 100), view, entityId: row.id, brand, product, url: `/api/workspace-attachments/${row.id}` });
  }
  const terms = sqlite.prepare("SELECT id, chinese, definition FROM terms WHERE chinese LIKE ? ESCAPE '\\' OR abbreviation LIKE ? ESCAPE '\\' OR english LIKE ? ESCAPE '\\' OR definition LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 8").all(pattern, pattern, pattern, pattern) as Array<{ id: string; chinese: string; definition: string }>;
  results.push(...terms.map((row) => ({ type: "术语" as const, title: formatSearchResultTitle(searchSections.terms, row.chinese), desc: row.definition.slice(0, 100), view: "terms", entityId: row.id })));
  const templates = sqlite.prepare("SELECT id, title, summary FROM templates WHERE title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 8").all(pattern, pattern, pattern) as Array<{ id: string; title: string; summary: string }>;
  results.push(...templates.map((row) => ({ type: "附件" as const, title: formatSearchResultTitle(searchSections.templates, row.title), desc: row.summary.slice(0, 100), view: "templates", entityId: row.id })));
  const links = sqlite.prepare("SELECT id, product_id, name, note FROM tracker_links WHERE deleted_at IS NULL AND (name LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\' OR platform LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT 8").all(pattern, pattern, pattern) as Array<{ id: string; product_id: string; name: string; note: string }>;
  for (const row of links) { const target = resolveProductNames(access.state, row.product_id); if (target && allowed(access, target.brand, target.product)) results.push({ type: "附件", title: formatSearchResultTitle(searchSections.tracker, row.name, target.brand, target.product), desc: row.note, view: "tracker-detail", entityId: row.id, brand: target.brand, product: target.product }); }
  const productTemplates = sqlite.prepare("SELECT id, brand, product, title, summary FROM product_templates WHERE title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 8").all(pattern, pattern, pattern) as Array<{ id: string; brand: string; product: string; title: string; summary: string }>;
  results.push(...productTemplates.filter((row) => allowed(access, row.brand, row.product)).map((row) => ({ type: "附件" as const, title: formatSearchResultTitle(searchSections.sop, row.title, row.brand, row.product), desc: row.summary, view: "sop-detail", entityId: row.id, brand: row.brand, product: row.product })));
  return Response.json({ results: results.slice(0, 24) });
}
