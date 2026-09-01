import { currentSession } from "../../../lib/auth";
import {
  createOrganizationTodoTemplate,
  readOrganizationTodoAdminDashboard,
  type OrganizationTodoInput,
} from "../../../../db/organization-todos";
import { audit, ensureWorkspaceRecordSchema } from "../../../../db/workspace-records";

async function adminSession(request: Request) {
  const session = await currentSession(request);
  if (!session?.user) return { session: null, denied: Response.json({ error: "请先登录。" }, { status: 401 }) };
  if ((session.user as typeof session.user & { role?: string }).role !== "admin") return { session: null, denied: Response.json({ error: "仅管理员可维护组织周期 Todo。" }, { status: 403 }) };
  return { session, denied: null };
}

export async function GET(request: Request) {
  const access = await adminSession(request);
  if (access.denied) return access.denied;
  try { return Response.json(readOrganizationTodoAdminDashboard()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "组织周期 Todo 读取失败。" }, { status: 500 }); }
}

export async function POST(request: Request) {
  const access = await adminSession(request);
  if (access.denied) return access.denied;
  if (!access.session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    const body = await request.json() as OrganizationTodoInput;
    const template = createOrganizationTodoTemplate(access.session.user.id, body);
    ensureWorkspaceRecordSchema();
    audit({ id: access.session.user.id, name: access.session.user.name }, "create", "organization-todo", template.id, `${template.title} · ${template.audienceType === "all" ? "全员" : `${template.recipientCount} 人`}`);
    return Response.json({ template }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "组织周期 Todo 创建失败。" }, { status: 400 }); }
}
