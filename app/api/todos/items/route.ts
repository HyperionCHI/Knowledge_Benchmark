import { currentSession } from "../../../lib/auth";
import { createTemporaryTodo, todayInTimeZone } from "../../../../db/todos";

export async function POST(request: Request) {
  const session = await currentSession(request);
  if (!session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    const body = await request.json() as { title?: string; scheduledFor?: string };
    const item = createTemporaryTodo(session.user.id, body.title || "", body.scheduledFor || todayInTimeZone());
    return Response.json({ item }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "待办创建失败。" }, { status: 400 });
  }
}
