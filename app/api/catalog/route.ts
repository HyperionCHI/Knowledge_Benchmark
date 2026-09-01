import { currentSession } from "../../lib/auth";
import { ensureWorkspaceAssetSchema } from "../../../db/workspace-assets";
import { readWorkspaceSnapshot, WorkspaceConflictError, type WorkspaceState } from "../../../db/workspace";
import { sqlite } from "../../../db/local";
import { ensureWorkspaceRecordSchema } from "../../../db/workspace-records";

type Usage = { products: number; links: number; sops: number; templates: number; attachments: number };

async function requireAdmin(request: Request) {
  const session = await currentSession(request);
  if (!session?.user) return { denied: Response.json({ error: "请先登录。" }, { status: 401 }), session: null };
  if ((session.user as typeof session.user & { role?: string }).role !== "admin") return { denied: Response.json({ error: "仅管理员可维护品牌和产品。" }, { status: 403 }), session: null };
  return { denied: null, session };
}

function locate(state: WorkspaceState, kind: "brand" | "product", id: string) {
  if (kind === "brand") {
    const brand = state.brands.find((name) => state.brandIds[name] === id);
    return brand ? { brand, product: "" } : null;
  }
  for (const brand of state.brands) for (const product of state.productsByBrand[brand] || []) if (state.productIds[`${brand}/${product}`] === id) return { brand, product };
  return null;
}

async function usageFor(state: WorkspaceState, brand: string, product = ""): Promise<Usage> {
  await ensureWorkspaceAssetSchema(); ensureWorkspaceRecordSchema(state);
  const where = product ? "brand = ? AND product = ?" : "brand = ?";
  const params = product ? [brand, product] : [brand];
  const templates = sqlite.prepare(`SELECT COUNT(*) AS total FROM product_templates WHERE ${where}`).get(...params) as { total: number };
  const attachments = sqlite.prepare(`SELECT COUNT(*) AS total FROM workspace_attachments WHERE ${where}`).get(...params) as { total: number };
  const brandId = state.brandIds[brand], productId = product ? state.productIds[`${brand}/${product}`] : "";
  const recordWhere = product ? "product_id = ?" : "brand_id = ?"; const recordParam = product ? productId : brandId;
  const links = sqlite.prepare(`SELECT COUNT(*) AS total FROM tracker_links WHERE ${recordWhere} AND deleted_at IS NULL`).get(recordParam) as { total: number };
  const sops = sqlite.prepare(`SELECT COUNT(*) AS total FROM knowledge_documents d JOIN knowledge_spaces s ON s.id = d.space_id WHERE s.kind = 'sop' AND s.${recordWhere} AND d.deleted_at IS NULL`).get(recordParam) as { total: number };
  return {
    products: product ? 0 : (state.productsByBrand[brand] || []).length,
    links: Number(links.total || 0),
    sops: Number(sops.total || 0),
    templates: Number(templates.total || 0),
    attachments: Number(attachments.total || 0),
  };
}

function commit(state: WorkspaceState, revision: number, rename?: { oldBrand: string; newBrand: string; oldProduct?: string; newProduct?: string }) {
  const payload = JSON.stringify(state);
  if (payload.length > 1_500_000) throw new Error("工作台数据体积超出限制。");
  return sqlite.transaction(() => {
    const result = sqlite.prepare("UPDATE workspace_state SET payload = ?, updated_at = ?, revision = revision + 1 WHERE id = 'main' AND revision = ?").run(payload, new Date().toISOString(), revision);
    if (!result.changes) throw new WorkspaceConflictError();
    if (rename?.oldProduct && rename.newProduct) {
      sqlite.prepare("UPDATE product_templates SET brand = ?, product = ? WHERE brand = ? AND product = ?").run(rename.newBrand, rename.newProduct, rename.oldBrand, rename.oldProduct);
      sqlite.prepare("UPDATE workspace_attachments SET brand = ?, product = ? WHERE brand = ? AND product = ?").run(rename.newBrand, rename.newProduct, rename.oldBrand, rename.oldProduct);
    } else if (rename) {
      sqlite.prepare("UPDATE product_templates SET brand = ? WHERE brand = ?").run(rename.newBrand, rename.oldBrand);
      sqlite.prepare("UPDATE workspace_attachments SET brand = ? WHERE brand = ?").run(rename.newBrand, rename.oldBrand);
    }
    return revision + 1;
  })();
}

export async function GET(request: Request) {
  const access = await requireAdmin(request); if (access.denied) return access.denied;
  const snapshot = await readWorkspaceSnapshot();
  const url = new URL(request.url); const kind = url.searchParams.get("kind") === "product" ? "product" : "brand"; const id = url.searchParams.get("id") || "";
  const target = locate(snapshot.state, kind, id); if (!target) return Response.json({ error: "品牌或产品不存在。" }, { status: 404 });
  return Response.json({ usage: await usageFor(snapshot.state, target.brand, target.product) });
}

export async function PUT(request: Request) {
  const access = await requireAdmin(request); if (access.denied) return access.denied;
  try {
    await ensureWorkspaceAssetSchema();
    const body = await request.json() as { kind?: "brand" | "product"; id?: string; name?: string; revision?: number };
    if ((body.kind !== "brand" && body.kind !== "product") || !body.id || typeof body.revision !== "number") return Response.json({ error: "请求参数不完整。" }, { status: 400 });
    const name = body.name?.trim() || ""; if (!name || name.length > 40) return Response.json({ error: "名称需为 1–40 个字符。" }, { status: 400 });
    const snapshot = await readWorkspaceSnapshot(); if (snapshot.revision !== body.revision) throw new WorkspaceConflictError();
    const state = snapshot.state; const target = locate(state, body.kind, body.id); if (!target) return Response.json({ error: "品牌或产品不存在。" }, { status: 404 });
    if (body.kind === "brand") {
      if (state.brands.some((item) => item !== target.brand && item === name)) return Response.json({ error: "品牌名称已存在。" }, { status: 409 });
      const old = target.brand; if (old === name) return Response.json({ state, revision: snapshot.revision });
      state.brands = state.brands.map((item) => item === old ? name : item);
      state.productsByBrand[name] = state.productsByBrand[old] || []; delete state.productsByBrand[old];
      state.brandIds[name] = state.brandIds[old]; delete state.brandIds[old];
      state.brandIcons[name] = state.brandIcons[old] || "building"; delete state.brandIcons[old];
      for (const product of state.productsByBrand[name]) {
        const oldKey = `${old}/${product}`, newKey = `${name}/${product}`;
        state.productIds[newKey] = state.productIds[oldKey]; delete state.productIds[oldKey];
        if (state.productIcons[oldKey]) { state.productIcons[newKey] = state.productIcons[oldKey]; delete state.productIcons[oldKey]; }
      }
      state.links = state.links.map((item) => item.brand === old ? { ...item, brand: name } : item);
      state.sops = state.sops.map((item) => item.brand === old ? { ...item, brand: name } : item);
      state.sopCategories = state.sopCategories.map((item) => item.brand === old ? { ...item, brand: name } : item);
      const revision = commit(state, snapshot.revision, { oldBrand: old, newBrand: name });
      return Response.json({ state, revision });
    }
    const products = state.productsByBrand[target.brand] || [];
    if (products.some((item) => item !== target.product && item === name)) return Response.json({ error: "该品牌下已存在同名产品。" }, { status: 409 });
    const old = target.product; if (old === name) return Response.json({ state, revision: snapshot.revision });
    state.productsByBrand[target.brand] = products.map((item) => item === old ? name : item);
    const oldKey = `${target.brand}/${old}`, newKey = `${target.brand}/${name}`;
    state.productIds[newKey] = state.productIds[oldKey]; delete state.productIds[oldKey];
    if (state.productIcons[oldKey]) { state.productIcons[newKey] = state.productIcons[oldKey]; delete state.productIcons[oldKey]; }
    state.links = state.links.map((item) => item.brand === target.brand && item.product === old ? { ...item, product: name } : item);
    state.sops = state.sops.map((item) => item.brand === target.brand && item.product === old ? { ...item, product: name } : item);
    state.sopCategories = state.sopCategories.map((item) => item.brand === target.brand && item.product === old ? { ...item, product: name } : item);
    const revision = commit(state, snapshot.revision, { oldBrand: target.brand, newBrand: target.brand, oldProduct: old, newProduct: name });
    return Response.json({ state, revision });
  } catch (error) {
    if (error instanceof WorkspaceConflictError) return Response.json({ error: error.message, conflict: true }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : "名称更新失败。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const access = await requireAdmin(request); if (access.denied) return access.denied;
  try {
    const body = await request.json() as { kind?: "brand" | "product"; id?: string; revision?: number };
    if ((body.kind !== "brand" && body.kind !== "product") || !body.id || typeof body.revision !== "number") return Response.json({ error: "请求参数不完整。" }, { status: 400 });
    const snapshot = await readWorkspaceSnapshot(); if (snapshot.revision !== body.revision) throw new WorkspaceConflictError();
    const state = snapshot.state; const target = locate(state, body.kind, body.id); if (!target) return Response.json({ error: "品牌或产品不存在。" }, { status: 404 });
    const usage = await usageFor(state, target.brand, target.product); const total = Object.values(usage).reduce((sum, value) => sum + value, 0);
    if (total) return Response.json({ error: "该项目仍有关联数据，不能删除。请先迁移或删除关联内容。", usage }, { status: 409 });
    if (body.kind === "brand") {
      state.brands = state.brands.filter((item) => item !== target.brand); delete state.productsByBrand[target.brand]; delete state.brandIds[target.brand]; delete state.brandIcons[target.brand];
    } else {
      state.productsByBrand[target.brand] = (state.productsByBrand[target.brand] || []).filter((item) => item !== target.product); const key = `${target.brand}/${target.product}`; delete state.productIds[key]; delete state.productIcons[key];
    }
    const revision = commit(state, snapshot.revision);
    return Response.json({ state, revision });
  } catch (error) {
    if (error instanceof WorkspaceConflictError) return Response.json({ error: error.message, conflict: true }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : "删除失败。" }, { status: 500 });
  }
}
