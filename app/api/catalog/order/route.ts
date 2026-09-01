import { getWorkspaceAccess } from "../../../lib/authorize";
import { isWorkspaceScopeAllowed } from "../../../lib/workspace-scopes";
import { readWorkspaceSnapshot, writeWorkspaceState, WorkspaceConflictError } from "../../../../db/workspace";
import { audit, ensureWorkspaceRecordSchema } from "../../../../db/workspace-records";

type OrderBody = { kind?: "brands" | "products"; brandId?: string; ids?: string[]; revision?: number };

function sameIds(current: string[], requested: string[]) {
  return current.length === requested.length && current.every((id) => requested.includes(id)) && new Set(requested).size === requested.length;
}

function mergeSubset(current: string[], requested: string[], allowed: Set<string>) {
  let pointer = 0;
  return current.map((id) => allowed.has(id) ? requested[pointer++] : id);
}

export async function PUT(request: Request) {
  const access = await getWorkspaceAccess(request);
  if (access.denied || !access.profile || !access.session?.user || !access.state) return access.denied;
  if (access.profile.role !== "admin" && access.profile.role !== "editor") return Response.json({ error: "当前账号没有目录排序权限。" }, { status: 403 });

  try {
    const body = await request.json() as OrderBody;
    if ((body.kind !== "brands" && body.kind !== "products") || !Array.isArray(body.ids) || !body.ids.every((id) => typeof id === "string" && id.length > 0) || typeof body.revision !== "number") {
      return Response.json({ error: "排序参数不正确。" }, { status: 400 });
    }
    const snapshot = await readWorkspaceSnapshot();
    if (snapshot.revision !== body.revision) throw new WorkspaceConflictError();
    const state = snapshot.state;
    ensureWorkspaceRecordSchema(state);

    if (body.kind === "brands") {
      const current = state.brands.map((brand) => state.brandIds[brand]);
      const allowedIds = current.filter((id, index) => access.profile!.role === "admin" || isWorkspaceScopeAllowed(state, access.profile!.scopes, state.brands[index]));
      if (!sameIds(allowedIds, body.ids)) return Response.json({ error: "可排序品牌列表已变化，请刷新后重试。", conflict: true }, { status: 409 });
      const merged = mergeSubset(current, body.ids, new Set(allowedIds));
      const byId = new Map(state.brands.map((brand) => [state.brandIds[brand], brand]));
      state.brands = merged.map((id) => byId.get(id)!).filter(Boolean);
    } else {
      const brand = state.brands.find((name) => state.brandIds[name] === body.brandId);
      if (!brand) return Response.json({ error: "品牌不存在。" }, { status: 404 });
      if (access.profile.role !== "admin" && !isWorkspaceScopeAllowed(state, access.profile.scopes, brand)) return Response.json({ error: "没有该品牌的目录排序权限。" }, { status: 403 });
      const products = state.productsByBrand[brand] || [];
      const current = products.map((product) => state.productIds[`${brand}/${product}`]);
      const allowedIds = current.filter((id, index) => access.profile!.role === "admin" || isWorkspaceScopeAllowed(state, access.profile!.scopes, brand, products[index]));
      if (!sameIds(allowedIds, body.ids)) return Response.json({ error: "可排序产品列表已变化，请刷新后重试。", conflict: true }, { status: 409 });
      const merged = mergeSubset(current, body.ids, new Set(allowedIds));
      const byId = new Map(products.map((product) => [state.productIds[`${brand}/${product}`], product]));
      state.productsByBrand[brand] = merged.map((id) => byId.get(id)!).filter(Boolean);
    }

    const revision = await writeWorkspaceState(state, snapshot.revision);
    audit({ id: access.session.user.id, name: access.session.user.name }, "reorder", body.kind === "brands" ? "brand" : "product", body.brandId || "catalog", `${body.ids.length} 项`);
    return Response.json({ ordered: true, revision });
  } catch (error) {
    if (error instanceof WorkspaceConflictError) return Response.json({ error: error.message, conflict: true }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : "目录排序失败。" }, { status: 500 });
  }
}
