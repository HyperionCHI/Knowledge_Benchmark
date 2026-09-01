import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const databasePath = resolve("data/qa-todos.sqlite");
process.env.WORKBENCH_DB_PATH = databasePath;
process.env.WORKBENCH_ATTACHMENT_DIR = resolve("data/qa-todos-attachments");
process.env.BETTER_AUTH_URL = "http://localhost:3998";
process.env.BETTER_AUTH_SECRET = "qa-only-secret-for-personal-todos-2026";

await Promise.all([databasePath, `${databasePath}-wal`, `${databasePath}-shm`].map((path) => rm(path, { force: true })));

const bootstrap = await import("../app/api/auth-bootstrap/route");
const { auth } = await import("../app/lib/auth");
const usersRoute = await import("../app/api/users/route");
const dashboardRoute = await import("../app/api/todos/route");
const itemsRoute = await import("../app/api/todos/items/route");
const itemRoute = await import("../app/api/todos/items/[id]/route");
const templatesRoute = await import("../app/api/todos/templates/route");
const organizationAdminRoute = await import("../app/api/admin/organization-todos/route");
const organizationAdminItemRoute = await import("../app/api/admin/organization-todos/[id]/route");
const organizationDetailRoute = await import("../app/api/organization-todos/occurrences/[id]/route");
const { sqlite } = await import("../db/local");
const { todayInTimeZone } = await import("../db/todos");

type Item = {
  id: string;
  title: string;
  scheduledFor: string;
  status: "pending" | "completed";
  overdueDays: number;
  source?: "temporary" | "recurring" | "organization";
  organizationOccurrenceId?: string;
  progress?: { completed: number; pending: number; total: number };
};
type Dashboard = {
  today: string;
  todayItems: Item[];
  overdueItems: Item[];
  historyItems: Item[];
  temporaryItems: Item[];
  templates: Array<{ id: string; recurrenceMode: string }>;
  organizationItems: Item[];
};

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

async function signIn(username: string, password: string) {
  const response = await auth.handler(new Request("http://localhost:3998/api/auth/sign-in/username", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3998" },
    body: JSON.stringify({ username, password }),
  }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  return cookie;
}

function jsonRequest(path: string, cookie: string, method: string, body?: unknown) {
  return new Request(`http://localhost:3998${path}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function dashboard(cookie: string) {
  const response = await dashboardRoute.GET(jsonRequest("/api/todos", cookie, "GET"));
  assert.equal(response.status, 200);
  return await response.json() as Dashboard;
}

try {
  const setup = await bootstrap.POST(new Request("http://localhost:3998/api/auth-bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "todo_admin", password: "Todo-admin-password-2026", name: "Todo 管理员" }),
  }));
  assert.equal(setup.status, 200);
  const adminCookie = await signIn("todo_admin", "Todo-admin-password-2026");

  const viewerCreated = await usersRoute.POST(jsonRequest("/api/users", adminCookie, "POST", {
    username: "todo_viewer", password: "Todo-viewer-password-2026", name: "Todo 普通用户", role: "viewer", scopes: ["*"],
  }));
  assert.equal(viewerCreated.status, 201);
  const viewerCookie = await signIn("todo_viewer", "Todo-viewer-password-2026");

  const outsiderCreated = await usersRoute.POST(jsonRequest("/api/users", adminCookie, "POST", {
    username: "todo_outsider", password: "Todo-outsider-password-2026", name: "Todo 范围外用户", role: "viewer", scopes: ["*"],
  }));
  assert.equal(outsiderCreated.status, 201);
  const outsiderBody = await outsiderCreated.json() as { user: { id: string } };
  const outsiderCookie = await signIn("todo_outsider", "Todo-outsider-password-2026");

  const today = todayInTimeZone();
  const yesterday = addDays(today, -2);
  const quickCreated = await itemsRoute.POST(jsonRequest("/api/todos/items", adminCookie, "POST", { title: "今日临时待办" }));
  assert.equal(quickCreated.status, 201);
  const quick = (await quickCreated.json() as { item: Item }).item;
  assert.equal(quick.scheduledFor, today, "快速添加必须默认为今日截止");

  const overdueCreated = await itemsRoute.POST(jsonRequest("/api/todos/items", adminCookie, "POST", {
    title: "逾期待办", scheduledFor: yesterday,
  }));
  assert.equal(overdueCreated.status, 201);
  const overdue = (await overdueCreated.json() as { item: Item }).item;

  const calendarCreated = await templatesRoute.POST(jsonRequest("/api/todos/templates", adminCookie, "POST", {
    title: "每日固定任务", frequency: "daily", interval: 1, startDate: today,
    recurrenceMode: "calendar", missedPolicy: "latest_only",
  }));
  assert.equal(calendarCreated.status, 201);
  const calendar = (await calendarCreated.json() as { template: { id: string } }).template;
  await dashboard(adminCookie);
  await dashboard(adminCookie);
  const calendarInstances = (sqlite.prepare("SELECT scheduled_for FROM todo_items WHERE recurrence_template_id = ? ORDER BY scheduled_for").all(calendar.id) as Array<{ scheduled_for: string }>);
  assert.equal(calendarInstances.length, 2, "固定周期只应生成本期与下一期，重复读取不能无限扩张");
  assert.equal(calendarInstances[0].scheduled_for, today);
  assert.equal(calendarInstances[1].scheduled_for, addDays(today, 1));

  let current = await dashboard(adminCookie);
  assert.equal(current.todayItems[0].id, overdue.id, "逾期待办应置顶");
  assert.equal(current.todayItems[0].overdueDays, 2);

  const completed = await itemRoute.PATCH(jsonRequest(`/api/todos/items/${quick.id}`, adminCookie, "PATCH", { action: "complete" }), { params: Promise.resolve({ id: quick.id }) });
  assert.equal(completed.status, 200);
  current = await dashboard(adminCookie);
  assert.equal(current.todayItems.at(-1)?.id, quick.id, "当日完成待办应置底");
  assert.ok(current.historyItems.some((item) => item.id === quick.id));

  const overdueCompleted = await itemRoute.PATCH(jsonRequest(`/api/todos/items/${overdue.id}`, adminCookie, "PATCH", { action: "complete" }), { params: Promise.resolve({ id: overdue.id }) });
  assert.equal(overdueCompleted.status, 200);
  current = await dashboard(adminCookie);
  assert.ok(current.historyItems.some((item) => item.id === overdue.id));
  const reopened = await itemRoute.PATCH(jsonRequest(`/api/todos/items/${overdue.id}`, adminCookie, "PATCH", { action: "reopen" }), { params: Promise.resolve({ id: overdue.id }) });
  assert.equal(reopened.status, 200);
  current = await dashboard(adminCookie);
  assert.ok(current.overdueItems.some((item) => item.id === overdue.id), "历史取消勾选后应恢复为逾期待办");

  const completionCreated = await templatesRoute.POST(jsonRequest("/api/todos/templates", adminCookie, "POST", {
    title: "完成后一周", frequency: "weekly", interval: 1, startDate: today,
    recurrenceMode: "after_completion",
  }));
  assert.equal(completionCreated.status, 201);
  const completionTemplate = (await completionCreated.json() as { template: { id: string } }).template;
  let completionRows = sqlite.prepare("SELECT id, status, scheduled_for FROM todo_items WHERE recurrence_template_id = ?").all(completionTemplate.id) as Array<{ id: string; status: string; scheduled_for: string }>;
  assert.equal(completionRows.length, 1, "完成后周期创建时只应有当前实例");
  const completionDone = await itemRoute.PATCH(jsonRequest(`/api/todos/items/${completionRows[0].id}`, adminCookie, "PATCH", { action: "complete" }), { params: Promise.resolve({ id: completionRows[0].id }) });
  assert.equal(completionDone.status, 200);
  await dashboard(adminCookie);
  await dashboard(adminCookie);
  completionRows = sqlite.prepare("SELECT id, status, scheduled_for FROM todo_items WHERE recurrence_template_id = ? ORDER BY scheduled_for").all(completionTemplate.id) as Array<{ id: string; status: string; scheduled_for: string }>;
  assert.equal(completionRows.length, 2, "完成后周期只能在完成动作后生成一个下一期");
  assert.equal(completionRows[1].scheduled_for, addDays(today, 7));

  const viewerDashboard = await dashboard(viewerCookie);
  assert.equal(viewerDashboard.todayItems.length, 0, "其他用户不能看到当前用户 Todo");
  assert.equal(viewerDashboard.templates.length, 0, "其他用户不能看到当前用户周期模板");
  const crossUserUpdate = await itemRoute.PATCH(jsonRequest(`/api/todos/items/${quick.id}`, viewerCookie, "PATCH", { action: "reopen" }), { params: Promise.resolve({ id: quick.id }) });
  assert.equal(crossUserUpdate.status, 404, "其他用户不能修改不属于自己的 Todo");

  const forbiddenAdminList = await organizationAdminRoute.GET(jsonRequest("/api/admin/organization-todos", viewerCookie, "GET"));
  assert.equal(forbiddenAdminList.status, 403, "普通用户不能进入组织周期 Todo 管理接口");

  const weekday = new Date(`${today}T12:00:00.000Z`).getUTCDay() || 7;
  const customCreated = await organizationAdminRoute.POST(jsonRequest("/api/admin/organization-todos", adminCookie, "POST", {
    title: "指定范围周任务", description: "仅指定人员可见", audienceType: "custom",
    recipientIds: [(await viewerCreated.json() as { user: { id: string } }).user.id],
    frequency: "weekly", interval: 1, weekdays: [weekday], startDate: today, missedPolicy: "latest_only",
  }));
  assert.equal(customCreated.status, 201);
  const customTemplate = (await customCreated.json() as { template: { id: string; currentOccurrence: { id: string } } }).template;
  assert.ok(customTemplate.currentOccurrence?.id, "开始日期为今天时应立即生成本期组织 Todo");

  let selectedDashboard = await dashboard(viewerCookie);
  const customAssignment = selectedDashboard.organizationItems.find((item) => item.organizationOccurrenceId === customTemplate.currentOccurrence.id);
  assert.ok(customAssignment, "指定人员应自动收到组织 Todo");
  assert.equal(customAssignment.progress?.total, 1);
  assert.equal((await dashboard(adminCookie)).organizationItems.some((item) => item.organizationOccurrenceId === customTemplate.currentOccurrence.id), false, "管理员未被选择时不应仅因角色收到指定范围任务");
  assert.equal((await dashboard(outsiderCookie)).organizationItems.some((item) => item.organizationOccurrenceId === customTemplate.currentOccurrence.id), false, "范围外用户不应收到指定任务");

  const selectedDetail = await organizationDetailRoute.GET(jsonRequest(`/api/organization-todos/occurrences/${customTemplate.currentOccurrence.id}`, viewerCookie, "GET"), { params: Promise.resolve({ id: customTemplate.currentOccurrence.id }) });
  assert.equal(selectedDetail.status, 200, "接收人可以查看人员完成详情");
  const outsiderDetail = await organizationDetailRoute.GET(jsonRequest(`/api/organization-todos/occurrences/${customTemplate.currentOccurrence.id}`, outsiderCookie, "GET"), { params: Promise.resolve({ id: customTemplate.currentOccurrence.id }) });
  assert.equal(outsiderDetail.status, 403, "范围外用户不能查看任务及人员名单");

  const organizationCompleted = await itemRoute.PATCH(jsonRequest(`/api/todos/items/${customAssignment.id}`, viewerCookie, "PATCH", { action: "complete" }), { params: Promise.resolve({ id: customAssignment.id }) });
  assert.equal(organizationCompleted.status, 200);
  const adminDetail = await organizationDetailRoute.GET(jsonRequest(`/api/organization-todos/occurrences/${customTemplate.currentOccurrence.id}`, adminCookie, "GET"), { params: Promise.resolve({ id: customTemplate.currentOccurrence.id }) });
  const adminDetailBody = await adminDetail.json() as { detail: { progress: { completed: number; total: number }; completed: Array<{ name: string }> } };
  assert.deepEqual(adminDetailBody.detail.progress, { completed: 1, pending: 0, total: 1, percent: 100 });
  assert.equal(adminDetailBody.detail.completed[0].name, "Todo 普通用户");

  const customUpdated = await organizationAdminItemRoute.PUT(jsonRequest(`/api/admin/organization-todos/${customTemplate.id}`, adminCookie, "PUT", {
    audienceType: "custom", recipientIds: [outsiderBody.user.id], applyToCurrent: true,
  }), { params: Promise.resolve({ id: customTemplate.id }) });
  assert.equal(customUpdated.status, 200);
  selectedDashboard = await dashboard(viewerCookie);
  assert.equal(selectedDashboard.organizationItems.some((item) => item.organizationOccurrenceId === customTemplate.currentOccurrence.id), false, "同步当前期移除后，原接收人不再看到任务");
  assert.equal((await dashboard(outsiderCookie)).organizationItems.some((item) => item.organizationOccurrenceId === customTemplate.currentOccurrence.id), true, "同步当前期新增后，新接收人应立即收到任务");
  const removedDetail = await organizationDetailRoute.GET(jsonRequest(`/api/organization-todos/occurrences/${customTemplate.currentOccurrence.id}`, viewerCookie, "GET"), { params: Promise.resolve({ id: customTemplate.currentOccurrence.id }) });
  assert.equal(removedDetail.status, 403, "从当前期移除后不能继续查看人员名单");

  const allCreated = await organizationAdminRoute.POST(jsonRequest("/api/admin/organization-todos", adminCookie, "POST", {
    title: "全员日任务", audienceType: "all", frequency: "daily", interval: 1, startDate: today,
  }));
  assert.equal(allCreated.status, 201);
  const allTemplate = (await allCreated.json() as { template: { currentOccurrence: { id: string; progress: { total: number } } } }).template;
  assert.equal(allTemplate.currentOccurrence.progress.total, 3, "全员任务应按全部有效账号生成接收状态");
  for (const cookie of [adminCookie, viewerCookie, outsiderCookie]) assert.equal((await dashboard(cookie)).organizationItems.some((item) => item.organizationOccurrenceId === allTemplate.currentOccurrence.id), true, "每个有效账号都应收到全员任务");
} finally {
  sqlite.close();
  await Promise.all([databasePath, `${databasePath}-wal`, `${databasePath}-shm`].map((path) => rm(path, { force: true })));
}

console.log("todos: ok");
