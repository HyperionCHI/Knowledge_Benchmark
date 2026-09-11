import { currentSession } from "./auth";
import { readWorkspaceState, type WorkspaceUser } from "../../db/workspace";
import { readWorkspaceUserPermissions } from "../../db/workspace-permissions";
import { canEditGeneralContent, canEditWorkspaceScope } from "./workspace-permissions";

export async function requireSignedIn(request: Request) {
  const session = await currentSession(request);
  return session?.user ? null : Response.json({ error: "请先登录。" }, { status: 401 });
}

export async function requireEditor(request: Request) {
  const access = await getWorkspaceAccess(request);
  if (access.denied || !access.profile) return access.denied;
  return canEditGeneralContent(access.profile) ? null : Response.json({ error: "当前账号没有通用内容编辑权限。" }, { status: 403 });
}

export async function getWorkspaceAccess(request: Request) {
  const session = await currentSession(request);
  if (!session?.user) return { denied: Response.json({ error: "请先登录。" }, { status: 401 }), session: null, profile: null };
  const state = await readWorkspaceState();
  const profile = state.users.find((item) => item.id === session.user.id) || {
    id: session.user.id, email: session.user.email, name: session.user.name,
    role: ((session.user as typeof session.user & { role?: string }).role || "viewer") as WorkspaceUser["role"], scopes: ["*"],
  };
  Object.assign(profile, readWorkspaceUserPermissions(state, profile));
  return { denied: null, session, profile, state };
}

export async function requireWorkspaceEditor(request: Request, brand: string, product: string) {
  const access = await getWorkspaceAccess(request);
  if (access.denied || !access.profile) return access.denied;
  if (access.profile.role === "admin") return null;
  const allowed = access.state && canEditWorkspaceScope(access.state, access.profile, brand, product);
  return allowed ? null : Response.json({ error: "当前账号没有该品牌或产品的编辑权限。" }, { status: 403 });
}
