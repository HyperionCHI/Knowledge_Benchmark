import { strToU8, zipSync } from "fflate";
import { getWorkspaceAccess } from "../../lib/authorize";
import { knowledgeDocumentPermission } from "../../lib/knowledge-permissions";
import { ensureWorkspaceRecordSchema, resolveProductNames } from "../../../db/workspace-records";
import { OTHER_KNOWLEDGE_SPACE_ID, ensureKnowledgeSchema, getKnowledgeSpace, getKnowledgeSpaceById, type KnowledgeDocumentRow } from "../../../db/knowledge";
import { getWorkspaceAssetBindings } from "../../../db/workspace-assets";
import { sqlite } from "../../../db/local";

const safe = (value: string) => value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 100) || "未命名";

export async function GET(request: Request) {
  const access = await getWorkspaceAccess(request);
  if (access.denied || !access.profile || !access.state) return access.denied;
  if (access.profile.role !== "admin") return Response.json({ error: "仅管理员可批量导出知识库。" }, { status: 403 });
  const url = new URL(request.url), requestedKind = url.searchParams.get("kind"), kind = requestedKind === "sop" ? "sop" : requestedKind === "other" ? "other" : "general", productId = url.searchParams.get("productId") || "";
  ensureWorkspaceRecordSchema(access.state); ensureKnowledgeSchema(access.state);
  const space = kind === "general" ? getKnowledgeSpace("general") : kind === "other" ? getKnowledgeSpaceById(OTHER_KNOWLEDGE_SPACE_ID) : getKnowledgeSpace("sop", productId);
  if (!space) return Response.json({ error: "知识空间不存在。" }, { status: 404 });
  const target = kind === "sop" ? resolveProductNames(access.state, productId) : null;
  const rows = sqlite.prepare(`SELECT d.*, c.name AS category_name, s.kind AS space_kind, s.brand_id, s.product_id
    FROM knowledge_documents d JOIN knowledge_categories c ON c.id = d.category_id JOIN knowledge_spaces s ON s.id = d.space_id
    WHERE d.space_id = ? AND d.deleted_at IS NULL ORDER BY c.sort_order, d.sort_order, d.updated_at`).all(space.id) as KnowledgeDocumentRow[];
  const documents = rows.filter((row) => knowledgeDocumentPermission(access.state!, access.profile!, row).canView);
  if (!documents.length) return Response.json({ error: "当前知识空间没有可导出的文档。" }, { status: 404 });

  const files: Record<string, Uint8Array> = {}, exportedAttachmentIds = new Set<string>();
  const manifest = { exportedAt: new Date().toISOString(), kind, brand: target?.brand || "", product: target?.product || "", documents: [] as Array<Record<string, unknown>>, attachments: [] as Array<Record<string, unknown>> };
  for (const document of documents) {
    const path = `文档/${safe(document.category_name)}/${String(document.sort_order + 1).padStart(2, "0")}-${safe(document.title)}.md`;
    files[path] = strToU8(`---\ntitle: ${JSON.stringify(document.title)}\ncategory: ${JSON.stringify(document.category_name)}\nstatus: ${document.status}\nversion: ${document.version}\nupdatedAt: ${document.updated_at}\nupdatedBy: ${JSON.stringify(document.updated_by)}\n---\n\n${document.body}\n`);
    const ids = sqlite.prepare("SELECT DISTINCT attachment_id FROM knowledge_document_assets WHERE document_id = ?").all(document.id) as Array<{ attachment_id: string }>;
    ids.forEach((item) => exportedAttachmentIds.add(item.attachment_id));
    manifest.documents.push({ id: document.id, title: document.title, category: document.category_name, status: document.status, version: document.version, path });
  }
  const { ATTACHMENTS } = getWorkspaceAssetBindings();
  for (const attachmentId of exportedAttachmentIds) {
    const versions = sqlite.prepare(`SELECT version, name, content_type, size, storage_key, created_by, created_at
      FROM workspace_attachment_versions WHERE attachment_id = ? ORDER BY version`).all(attachmentId) as Array<{ version: number; name: string; content_type: string; size: number; storage_key: string; created_by: string; created_at: string }>;
    for (const version of versions) {
      const object = await ATTACHMENTS.get(version.storage_key); if (!object) continue;
      const path = `附件/${attachmentId}/v${version.version}-${safe(version.name)}`;
      files[path] = new Uint8Array(object.body);
      manifest.attachments.push({ attachmentId, version: version.version, name: version.name, type: version.content_type, size: version.size, createdBy: version.created_by, createdAt: version.created_at, path });
    }
  }
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  files["README.txt"] = strToU8("本压缩包由内部知识工作台导出。文档保持 Markdown 格式；附件按资源 ID 和版本号组织，引用关系记录在 manifest.json。\n");
  const zip = zipSync(files, { level: 6 });
  const title = kind === "general" ? "通用资料与规章制度" : kind === "other" ? "其它资料" : `${target?.brand || "品牌"}-${target?.product || "产品"}-SOP`;
  return new Response(zip, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${title}-${new Date().toISOString().slice(0, 10)}.zip`)}`, "Cache-Control": "private, no-store" } });
}
