import { currentSession } from "../../lib/auth";
import { readTodoDashboard } from "../../../db/todos";
import { readOrganizationTodoDashboard } from "../../../db/organization-todos";

export async function GET(request: Request) {
  const session = await currentSession(request);
  if (!session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
  try {
    const personal = readTodoDashboard(session.user.id);
    const organization = readOrganizationTodoDashboard(session.user.id);
    const rank = (item: { status: string; scheduledFor: string }) => item.status === "completed" ? 2 : item.scheduledFor < personal.today ? 0 : 1;
    return Response.json({
      ...personal,
      todayItems: [...personal.todayItems, ...organization.todayItems].sort((left, right) => rank(left) - rank(right) || left.scheduledFor.localeCompare(right.scheduledFor)),
      overdueItems: [...personal.overdueItems, ...organization.overdueItems].sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor)),
      historyItems: [...personal.historyItems, ...organization.historyItems].sort((left, right) => String(right.completedAt).localeCompare(String(left.completedAt))).slice(0, 500),
      organizationItems: organization.organizationItems,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "待办读取失败。" }, { status: 500 });
  }
}
