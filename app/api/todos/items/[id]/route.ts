import { currentSession } from "../../../../lib/auth";
import { deleteTodoItem, updateTodoItem } from "../../../../../db/todos";
import { updateOrganizationTodoAssignment } from "../../../../../db/organization-todos";
import { audit, ensureWorkspaceRecordSchema } from "../../../../../db/workspace-records";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const session = await currentSession(request);
  if (!session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    const { id } = await params;
    const body = await request.json() as { action?: "complete" | "reopen"; title?: string; scheduledFor?: string };
    const personalItem = updateTodoItem(session.user.id, id, body);
    if (personalItem) return Response.json({ item: personalItem });
    const organizationItem = body.action ? updateOrganizationTodoAssignment(session.user.id, id, body.action) : null;
    if (!organizationItem) return Response.json({ error: "待办不存在。" }, { status: 404 });
    ensureWorkspaceRecordSchema();
    audit({ id: session.user.id, name: session.user.name }, body.action!, "organization-todo", organizationItem.organizationOccurrenceId, organizationItem.title);
    return Response.json({ item: organizationItem });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "待办更新失败。" }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const session = await currentSession(request);
  if (!session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
  const { id } = await params;
  return deleteTodoItem(session.user.id, id)
    ? Response.json({ deleted: true })
    : Response.json({ error: "临时待办不存在。" }, { status: 404 });
}
