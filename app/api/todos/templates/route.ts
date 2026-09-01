import { currentSession } from "../../../lib/auth";
import { createTodoTemplate, type TodoTemplateInput } from "../../../../db/todos";

export async function POST(request: Request) {
  const session = await currentSession(request);
  if (!session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    const body = await request.json() as TodoTemplateInput;
    return Response.json({ template: createTodoTemplate(session.user.id, body) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "周期任务创建失败。" }, { status: 400 });
  }
}
