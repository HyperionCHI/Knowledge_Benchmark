import { getWorkspaceAccess } from "../../../lib/authorize";
import { isWorkspaceScopeAllowed } from "../../../lib/workspace-scopes";
import { audit, ensureWorkspaceRecordSchema, resolveProductNames } from "../../../../db/workspace-records";
import { sqlite } from "../../../../db/local";

export async function PUT(request: Request) {
  const access = await getWorkspaceAccess(request);
  if (access.denied || !access.profile || !access.session?.user || !access.state) return access.denied;
  const body = await request.json() as { productId?: string; cycle?: string; ids?: string[] };
  const target = body.productId ? resolveProductNames(access.state, body.productId) : null;
  if (!target || !body.productId || !body.cycle || !Array.isArray(body.ids)) return Response.json({ error: "排序参数不正确。" }, { status: 400 });
  if (access.profile.role !== "admin" && (access.profile.role !== "editor" || !isWorkspaceScopeAllowed(access.state, access.profile.scopes, target.brand, target.product))) return Response.json({ error: "没有该产品的编辑权限。" }, { status: 403 });
  ensureWorkspaceRecordSchema(access.state);
  const productId = body.productId, cycle = body.cycle, ids = body.ids;
  const rows = sqlite.prepare("SELECT id FROM tracker_links WHERE product_id = ? AND cycle = ? AND deleted_at IS NULL ORDER BY sort_order").all(productId, cycle) as Array<{ id: string }>;
  const existing = rows.map((row) => row.id);
  if (existing.length !== ids.length || existing.some((id) => !ids.includes(id))) return Response.json({ error: "排序列表已变化，请刷新后重试。", conflict: true }, { status: 409 });
  const now = new Date().toISOString();
  sqlite.transaction(() => ids.forEach((id, index) => sqlite.prepare("UPDATE tracker_links SET sort_order = ?, updated_at = ? WHERE id = ?").run(index, now, id)))();
  audit({ id: access.session.user.id, name: access.session.user.name }, "reorder", "tracker-link", productId, cycle);
  return Response.json({ ordered: true });
}
