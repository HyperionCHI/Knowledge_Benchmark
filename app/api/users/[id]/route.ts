import { currentSession } from "../../../lib/auth";
import { getLocalDatabase } from "../../../../db/local";
import { readWorkspaceState, writeWorkspaceState, type WorkspaceUser } from "../../../../db/workspace";
import { normalizeWorkspaceScopes } from "../../../lib/workspace-scopes";

async function requireAdmin(request: Request) {
  const session = await currentSession(request);
  if (!session?.user) return { response: Response.json({ error: "请先登录。" }, { status: 401 }) };
  if ((session.user as typeof session.user & { role?: string }).role !== "admin") return { response: Response.json({ error: "仅管理员可维护账号。" }, { status: 403 }) };
  return { session };
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdmin(request); if (access.response) return access.response;
  const id = (await params).id;
  const body = await request.json() as { name?: string; role?: WorkspaceUser["role"]; scopes?: string[] };
  const name = body.name?.trim();
  const role = body.role;
  if (!name || !role || !["admin", "editor", "viewer"].includes(role)) return Response.json({ error: "成员名称或角色不正确。" }, { status: 400 });
  if (id === access.session.user.id && role !== "admin") return Response.json({ error: "不能降低当前登录管理员自己的权限。" }, { status: 400 });
  const DB = getLocalDatabase();
  const result = await DB.prepare("UPDATE user SET name = ?, role = ?, updated_at = ? WHERE id = ?").bind(name, role, Date.now(), id).run();
  if (!result.meta.changes) return Response.json({ error: "成员不存在。" }, { status: 404 });
  const state = await readWorkspaceState();
  const scopes = normalizeWorkspaceScopes(state, Array.isArray(body.scopes) ? body.scopes : ["*"]);
  const existing = state.users.find((user) => user.id === id);
  if (existing) Object.assign(existing, { name, role, scopes });
  else {
    const identity = await DB.prepare("SELECT email FROM user WHERE id = ?").bind(id).first<{ email: string }>();
    state.users.push({ id, name, email: identity?.email || "", role, scopes });
  }
  await writeWorkspaceState(state);
  return Response.json({ updated: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdmin(request); if (access.response) return access.response;
  const id = (await params).id;
  if (id === access.session.user.id) return Response.json({ error: "不能删除当前登录账号。" }, { status: 400 });
  const DB = getLocalDatabase();
  const target = await DB.prepare("SELECT role FROM user WHERE id = ?").bind(id).first<{ role: string }>();
  if (!target) return Response.json({ error: "成员不存在。" }, { status: 404 });
  if (target.role === "admin") {
    const admins = await DB.prepare("SELECT COUNT(*) AS total FROM user WHERE role = 'admin'").first<{ total: number }>();
    if (Number(admins?.total || 0) <= 1) return Response.json({ error: "至少需要保留一个管理员。" }, { status: 400 });
  }
  await DB.prepare("DELETE FROM user WHERE id = ?").bind(id).run();
  const state = await readWorkspaceState(); state.users = state.users.filter((user) => user.id !== id); await writeWorkspaceState(state);
  return Response.json({ deleted: true });
}
