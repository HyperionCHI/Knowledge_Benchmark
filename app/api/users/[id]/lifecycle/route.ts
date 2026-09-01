import { auth, currentSession } from "../../../../lib/auth";
import { audit, ensureWorkspaceRecordSchema } from "../../../../../db/workspace-records";
import { readWorkspaceState } from "../../../../../db/workspace";
import { sqlite } from "../../../../../db/local";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession(request); if (!session?.user) return Response.json({ error: "请先登录。" }, { status: 401 }); if ((session.user as typeof session.user & { role?: string }).role !== "admin") return Response.json({ error: "仅管理员可维护账号状态。" }, { status: 403 });
  const userId = (await params).id; const body = await request.json() as { action?: "reset-password" | "revoke-sessions" | "ban" | "unban"; password?: string }; if (!body.action) return Response.json({ error: "缺少操作类型。" }, { status: 400 }); if (userId === session.user.id && body.action === "ban") return Response.json({ error: "不能停用当前登录账号。" }, { status: 400 });
  const target = sqlite.prepare("SELECT id, name FROM user WHERE id = ?").get(userId) as { id: string; name: string } | undefined; if (!target) return Response.json({ error: "账号不存在。" }, { status: 404 });
  if (body.action === "reset-password") { if (!body.password || body.password.length < 8) return Response.json({ error: "新密码至少 8 位。" }, { status: 400 }); await auth.api.setUserPassword({ body: { userId, newPassword: body.password }, headers: request.headers }); await auth.api.revokeUserSessions({ body: { userId }, headers: request.headers }); }
  if (body.action === "revoke-sessions") await auth.api.revokeUserSessions({ body: { userId }, headers: request.headers });
  if (body.action === "ban") await auth.api.banUser({ body: { userId, banReason: "由内部知识工作台管理员停用" }, headers: request.headers });
  if (body.action === "unban") await auth.api.unbanUser({ body: { userId }, headers: request.headers });
  ensureWorkspaceRecordSchema(await readWorkspaceState()); audit({ id: session.user.id, name: session.user.name }, body.action, "user", userId, target.name);
  return Response.json({ updated: true });
}
