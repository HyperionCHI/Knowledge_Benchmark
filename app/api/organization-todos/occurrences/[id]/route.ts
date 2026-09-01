import { currentSession } from "../../../../lib/auth";
import { readOrganizationTodoOccurrence } from "../../../../../db/organization-todos";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const session = await currentSession(request);
  if (!session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
  const { id } = await params;
  const role = (session.user as typeof session.user & { role?: string }).role || "viewer";
  const detail = readOrganizationTodoOccurrence(session.user.id, role, id);
  if (detail === false) return Response.json({ error: "没有该任务的查看权限。" }, { status: 403 });
  return detail ? Response.json({ detail }) : Response.json({ error: "组织周期 Todo 不存在。" }, { status: 404 });
}
