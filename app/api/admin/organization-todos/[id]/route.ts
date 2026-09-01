import { currentSession } from "../../../../lib/auth";
import {
  archiveOrganizationTodo,
  setOrganizationTodoPaused,
  updateOrganizationTodoTemplate,
  type OrganizationTodoInput,
} from "../../../../../db/organization-todos";
import { audit, ensureWorkspaceRecordSchema } from "../../../../../db/workspace-records";

type Context = { params: Promise<{ id: string }> };

async function allowed(request: Request) {
  const session = await currentSession(request);
  if (!session?.user) return { session: null, denied: Response.json({ error: "请先登录。" }, { status: 401 }) };
  if ((session.user as typeof session.user & { role?: string }).role !== "admin") return { session: null, denied: Response.json({ error: "仅管理员可维护组织周期 Todo。" }, { status: 403 }) };
  return { session, denied: null };
}

export async function PUT(request: Request, { params }: Context) {
  const access = await allowed(request); if (access.denied) return access.denied; if (!access.session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    const { id } = await params;
    const template = updateOrganizationTodoTemplate(id, await request.json() as OrganizationTodoInput);
    if (!template) return Response.json({ error: "组织周期 Todo 不存在。" }, { status: 404 });
    ensureWorkspaceRecordSchema();
    audit({ id: access.session.user.id, name: access.session.user.name }, "update", "organization-todo", id, template.title);
    return Response.json({ template });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "组织周期 Todo 更新失败。" }, { status: 400 }); }
}

export async function PATCH(request: Request, { params }: Context) {
  const access = await allowed(request); if (access.denied) return access.denied; if (!access.session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
  const { id } = await params;
  const body = await request.json() as { paused?: boolean };
  if (!setOrganizationTodoPaused(id, Boolean(body.paused))) return Response.json({ error: "组织周期 Todo 不存在。" }, { status: 404 });
  ensureWorkspaceRecordSchema();
  audit({ id: access.session.user.id, name: access.session.user.name }, body.paused ? "pause" : "resume", "organization-todo", id);
  return Response.json({ updated: true });
}

export async function DELETE(request: Request, { params }: Context) {
  const access = await allowed(request); if (access.denied) return access.denied; if (!access.session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
  const { id } = await params;
  if (!archiveOrganizationTodo(id)) return Response.json({ error: "组织周期 Todo 不存在。" }, { status: 404 });
  ensureWorkspaceRecordSchema();
  audit({ id: access.session.user.id, name: access.session.user.name }, "archive", "organization-todo", id);
  return Response.json({ archived: true });
}
