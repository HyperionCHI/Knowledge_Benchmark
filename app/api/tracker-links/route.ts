import { getWorkspaceAccess } from "../../lib/authorize";
import { isWorkspaceScopeAllowed } from "../../lib/workspace-scopes";
import { audit, ensureWorkspaceRecordSchema, resolveProductNames } from "../../../db/workspace-records";
import { sqlite } from "../../../db/local";

export async function POST(request: Request) {
  const access = await getWorkspaceAccess(request); if (access.denied || !access.profile || !access.session?.user || !access.state) return access.denied;
  const body = await request.json() as { id?: string; productId?: string; name?: string; url?: string; cycle?: string; platform?: string; note?: string; color?: string };
  const target = body.productId ? resolveProductNames(access.state, body.productId) : null; if (!target) return Response.json({ error: "产品不存在。" }, { status: 404 });
  if (access.profile.role !== "admin" && (access.profile.role !== "editor" || !isWorkspaceScopeAllowed(access.state, access.profile.scopes, target.brand, target.product))) return Response.json({ error: "没有该产品的编辑权限。" }, { status: 403 });
  const name = body.name?.trim() || "", url = body.url?.trim() || ""; if (!name || name.length > 15) return Response.json({ error: "链接名称需为 1–15 个字符。" }, { status: 400 }); try { new URL(url); } catch { return Response.json({ error: "链接地址无效。" }, { status: 400 }); }
  ensureWorkspaceRecordSchema(access.state); const id = body.id || crypto.randomUUID(), now = new Date().toISOString(), cycle = body.cycle || "daily";
  const order = (sqlite.prepare("SELECT COALESCE(MAX(sort_order) + 1, 0) AS value FROM tracker_links WHERE product_id = ? AND cycle = ? AND deleted_at IS NULL").get(body.productId, cycle) as { value: number }).value;
  sqlite.prepare(`INSERT INTO tracker_links (id, brand_id, product_id, name, url, cycle, platform, note, color, created_by, updated_by, created_at, updated_at, version, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(id, target.brandId, body.productId, name, url, cycle, body.platform?.trim() || "", body.note?.trim() || "", body.color || "#2859e8", access.session.user.name, access.session.user.name, now, now, order);
  audit({ id: access.session.user.id, name: access.session.user.name }, "create", "tracker-link", id, name);
  return Response.json({ link: { id, brand: target.brand, product: target.product, name, url, cycle, platform: body.platform?.trim() || "", note: body.note?.trim() || "", color: body.color || "#2859e8", createdAt: now, updatedAt: now, updatedBy: access.session.user.name, version: 1, sortOrder: order } }, { status: 201 });
}
