import { currentSession } from "../../../lib/auth";
import { ensureWorkspaceRecordSchema } from "../../../../db/workspace-records";
import { readWorkspaceState } from "../../../../db/workspace";
import { sqlite } from "../../../../db/local";

export async function GET(request: Request) {
  const session = await currentSession(request); if (!session?.user) return Response.json({ error: "请先登录。" }, { status: 401 }); if ((session.user as typeof session.user & { role?: string }).role !== "admin") return Response.json({ error: "仅管理员可查看审计日志。" }, { status: 403 }); ensureWorkspaceRecordSchema(await readWorkspaceState());
  const url = new URL(request.url); const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 300);
  const logs = sqlite.prepare("SELECT id, actor_id AS actorId, actor_name AS actorName, action, entity_type AS entityType, entity_id AS entityId, detail, created_at AS createdAt FROM audit_logs ORDER BY created_at DESC LIMIT ?").all(limit);
  return Response.json({ logs });
}
