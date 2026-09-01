import { auth, currentSession } from "../../lib/auth";
import { getLocalDatabase } from "../../../db/local";
import { readWorkspaceState, writeWorkspaceState, type WorkspaceUser } from "../../../db/workspace";
import { normalizeWorkspaceScopes } from "../../lib/workspace-scopes";

type AuthUserRow = { id: string; name: string; email: string; username: string | null; role: WorkspaceUser["role"]; banned: number };

async function requireAdmin(request: Request) {
  const session = await currentSession(request);
  if (!session?.user) return { response: Response.json({ error: "请先登录。" }, { status: 401 }) };
  if ((session.user as typeof session.user & { role?: string }).role !== "admin") return { response: Response.json({ error: "仅管理员可维护账号。" }, { status: 403 }) };
  return { session };
}

export async function GET(request: Request) {
  const access = await requireAdmin(request); if (access.response) return access.response;
  const state = await readWorkspaceState();
  const rows = await getLocalDatabase().prepare("SELECT id, name, email, username, role, banned FROM user ORDER BY created_at ASC").all<AuthUserRow>();
  return Response.json({ users: rows.results.map((row) => ({
    ...row,
    banned: Boolean(row.banned),
    scopes: normalizeWorkspaceScopes(state, state.users.find((profile) => profile.id === row.id)?.scopes || ["*"]),
  })) });
}

export async function POST(request: Request) {
  const access = await requireAdmin(request); if (access.response) return access.response;
  try {
    const body = await request.json() as { username?: string; password?: string; name?: string; role?: WorkspaceUser["role"]; scopes?: string[] };
    const usernameValue = body.username?.trim().toLowerCase() || "";
    const name = body.name?.trim() || usernameValue;
    const role = body.role && ["admin", "editor", "viewer"].includes(body.role) ? body.role : "viewer";
    const state = await readWorkspaceState();
    const scopes = normalizeWorkspaceScopes(state, Array.isArray(body.scopes) ? body.scopes : ["*"]);
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(usernameValue)) return Response.json({ error: "账号需为 3–30 位字母、数字、点、下划线或短横线。" }, { status: 400 });
    if (!body.password || body.password.length < 8) return Response.json({ error: "密码至少 8 位。" }, { status: 400 });
    const result = await auth.api.signUpEmail({ body: { email: `${usernameValue}@knowledge-workbench.local`, name, password: body.password, username: usernameValue, displayUsername: usernameValue } });
    await getLocalDatabase().prepare("UPDATE user SET role = ? WHERE id = ?").bind(role, result.user.id).run();
    const profile: WorkspaceUser = { id: result.user.id, name, email: result.user.email, role, scopes };
    state.users = [...state.users.filter((user) => user.id !== profile.id), profile];
    await writeWorkspaceState(state);
    return Response.json({ user: { ...profile, username: usernameValue } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "账号创建失败";
    return Response.json({ error: /unique|already|exists/i.test(message) ? "该账号已存在。" : message }, { status: 400 });
  }
}
