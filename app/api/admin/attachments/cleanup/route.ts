import { currentSession } from "../../../../lib/auth";
import { audit } from "../../../../../db/workspace-records";
import { getWorkspaceAssetBindings, type WorkspaceAttachmentRow } from "../../../../../db/workspace-assets";
import { scanOrphanAttachments } from "../../../../lib/orphan-attachments";

async function scan(request: Request) {
  const session = await currentSession(request); if (!session?.user) return { denied: Response.json({ error: "请先登录。" }, { status: 401 }), session: null, rows: [] as WorkspaceAttachmentRow[] }; if ((session.user as typeof session.user & { role?: string }).role !== "admin") return { denied: Response.json({ error: "仅管理员可清理附件。" }, { status: 403 }), session: null, rows: [] as WorkspaceAttachmentRow[] };
  const rows = await scanOrphanAttachments(); return { denied: null, session, rows };
}

export async function GET(request: Request) { const result = await scan(request); if (result.denied) return result.denied; return Response.json({ count: result.rows.length, attachments: result.rows.map((row) => ({ id: row.id, name: row.name, title: row.title, size: row.size, scope: row.scope, brand: row.brand, product: row.product, createdAt: row.created_at, reason: row.scope === "doc" || row.scope === "other-doc" || row.scope === "sop" ? "仅被已删除文章引用" : "未被任何有效内容引用" })) }); }

export async function POST(request: Request) { const result = await scan(request); if (result.denied || !result.session?.user) return result.denied; const { DB, ATTACHMENTS } = getWorkspaceAssetBindings(); let deleted = 0; for (const row of result.rows) { const versions = await DB.prepare("SELECT storage_key FROM workspace_attachment_versions WHERE attachment_id = ?").bind(row.id).all<{ storage_key: string }>(); const keys = [...new Set([row.storage_key, ...versions.results.map((version) => version.storage_key)])]; await Promise.all(keys.map((key) => ATTACHMENTS.delete(key))); await DB.prepare("DELETE FROM workspace_attachments WHERE id = ?").bind(row.id).run(); deleted += 1; } audit({ id: result.session.user.id, name: result.session.user.name }, "cleanup", "attachment", "orphans", `${deleted} 个`); return Response.json({ deleted }); }
