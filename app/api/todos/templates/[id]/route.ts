import { currentSession } from "../../../../lib/auth";
import {
  deleteTodoTemplate, setTodoTemplatePaused, updateTodoTemplate,
  type TodoTemplateInput,
} from "../../../../../db/todos";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Context) {
  const session = await currentSession(request);
  if (!session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    const { id } = await params;
    const body = await request.json() as TodoTemplateInput;
    const template = updateTodoTemplate(session.user.id, id, body);
    return template ? Response.json({ template }) : Response.json({ error: "周期任务不存在。" }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "周期任务更新失败。" }, { status: 400 });
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const session = await currentSession(request);
  if (!session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
  const { id } = await params;
  const body = await request.json() as { paused?: boolean };
  if (typeof body.paused !== "boolean") return Response.json({ error: "暂停状态无效。" }, { status: 400 });
  return setTodoTemplatePaused(session.user.id, id, body.paused)
    ? Response.json({ saved: true })
    : Response.json({ error: "周期任务不存在。" }, { status: 404 });
}

export async function DELETE(request: Request, { params }: Context) {
  const session = await currentSession(request);
  if (!session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
  const { id } = await params;
  return deleteTodoTemplate(session.user.id, id)
    ? Response.json({ deleted: true })
    : Response.json({ error: "周期任务不存在。" }, { status: 404 });
}
