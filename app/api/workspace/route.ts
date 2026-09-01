import { readWorkspaceSnapshot, writeWorkspaceState, WorkspaceConflictError, type WorkspaceUser } from "../../../db/workspace";
import { currentSession } from "../../lib/auth";
import { isWorkspaceScopeAllowed, normalizeWorkspaceScopes } from "../../lib/workspace-scopes";
import { readWorkspaceRecords } from "../../../db/workspace-records";

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
    const snapshot = await readWorkspaceSnapshot(); const state = snapshot.state; Object.assign(state, readWorkspaceRecords(state)); let revision = snapshot.revision;
    const identity = { id: session.user.id, email: session.user.email, name: session.user.name };
    let profile = state.users.find((user) => user.id === identity.id);
    if (!profile) {
      profile = { ...identity, role: ((session.user as typeof session.user & { role?: string }).role as WorkspaceUser["role"]) || (state.users.length === 0 ? "admin" : "viewer"), scopes: ["*"] } satisfies WorkspaceUser;
      state.users.push(profile);
      revision = await writeWorkspaceState(state, revision);
    }
    profile.scopes = normalizeWorkspaceScopes(state, profile.scopes);
    state.docs = state.docs.map((item) => {
      const collaborator = item.collaborators?.find((entry) => entry.userId === identity.id);
      const canEdit = profile.role === "admin" || collaborator?.permission === "edit" || (profile.role === "editor" && !item.collaborators?.length);
      return { ...item, canEdit, canManage: profile.role === "admin" };
    }).filter((item) => item.status === "published" || item.canEdit || item.collaborators?.some((entry) => entry.userId === identity.id));
    state.otherDocs = state.otherDocs.map((item) => {
      const collaborator = item.collaborators?.find((entry) => entry.userId === identity.id);
      const canEdit = profile.role === "admin" || collaborator?.permission === "edit" || (profile.role === "editor" && !item.collaborators?.length);
      return { ...item, canEdit, canManage: profile.role === "admin" };
    }).filter((item) => item.status === "published" || item.canEdit || item.collaborators?.some((entry) => entry.userId === identity.id));
    state.sops = state.sops.map((item) => {
      const scopeAllowed = isWorkspaceScopeAllowed(state, profile.scopes, item.brand, item.product);
      const collaborator = item.collaborators?.find((entry) => entry.userId === identity.id);
      const canEdit = profile.role === "admin" || (scopeAllowed && (collaborator?.permission === "edit" || (profile.role === "editor" && !item.collaborators?.length)));
      return { ...item, canEdit, canManage: profile.role === "admin" };
    }).filter((item) => {
      const scopeAllowed = profile.role === "admin" || isWorkspaceScopeAllowed(state, profile.scopes, item.brand, item.product);
      return scopeAllowed && (item.status === "published" || item.canEdit || item.collaborators?.some((entry) => entry.userId === identity.id));
    });
    const visibleState = profile.role === "admin" || profile.scopes.includes("*") ? state : {
      ...state,
      brands: state.brands.filter((brand) => isWorkspaceScopeAllowed(state, profile.scopes, brand)),
      productsByBrand: Object.fromEntries(state.brands.map((brand) => [brand, (state.productsByBrand[brand] || []).filter((product) => isWorkspaceScopeAllowed(state, profile.scopes, brand, product))])),
      links: state.links.filter((item) => isWorkspaceScopeAllowed(state, profile.scopes, item.brand, item.product)),
      sops: state.sops.filter((item) => isWorkspaceScopeAllowed(state, profile.scopes, item.brand, item.product)),
      sopCategories: state.sopCategories.filter((item) => isWorkspaceScopeAllowed(state, profile.scopes, item.brand, item.product)),
      users: [],
    };
    return Response.json({ state: visibleState, profile, revision });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "工作台加载失败" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
    const snapshot = await readWorkspaceSnapshot(); const current = snapshot.state;
    const profile = current.users.find((user) => user.id === session.user.id);
    if (!profile || profile.role === "viewer") return Response.json({ error: "当前账号没有编辑权限。" }, { status: 403 });
    const body = await request.json() as { state?: typeof current; revision?: number };
    if (!body.state || !Array.isArray(body.state.brands) || !Array.isArray(body.state.products)) return Response.json({ error: "数据格式不正确。" }, { status: 400 });
    if (profile.role !== "admin") {
      body.state.brands = current.brands;
      body.state.products = current.products;
      body.state.productsByBrand = current.productsByBrand;
      body.state.brandIds = current.brandIds;
      body.state.productIds = current.productIds;
      body.state.brandIcons = current.brandIcons;
      body.state.productIcons = current.productIcons;
      body.state.docCategories = current.docCategories;
      body.state.docs = current.docs;
      body.state.otherDocCategories = current.otherDocCategories;
      body.state.otherDocs = current.otherDocs;
      body.state.users = current.users;
      body.state.links = [
        ...current.links.filter((item) => !isWorkspaceScopeAllowed(current, profile.scopes, item.brand, item.product)),
        ...body.state.links.filter((item) => isWorkspaceScopeAllowed(current, profile.scopes, item.brand, item.product)),
      ];
      body.state.sops = [
        ...current.sops.filter((item) => !isWorkspaceScopeAllowed(current, profile.scopes, item.brand, item.product)),
        ...body.state.sops.filter((item) => isWorkspaceScopeAllowed(current, profile.scopes, item.brand, item.product)),
      ];
    }
    if (typeof body.revision !== "number") return Response.json({ error: "缺少数据版本，请刷新页面后重试。" }, { status: 428 });
    const revision = await writeWorkspaceState(body.state, body.revision);
    return Response.json({ saved: true, revision, updatedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof WorkspaceConflictError) return Response.json({ error: error.message, conflict: true }, { status: 409 });
    return Response.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 500 });
  }
}
