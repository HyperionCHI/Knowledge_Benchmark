import { type Options, type Weekday } from "rrule";
import rrulePackage from "rrule/dist/es5/rrule.js";
import { sqlite } from "./local";
import { todayInTimeZone } from "./todos";

const { RRule, rrulestr } = rrulePackage;

export type OrganizationTodoAudience = "all" | "custom";
export type OrganizationTodoInput = {
  title?: string;
  description?: string;
  audienceType?: OrganizationTodoAudience;
  recipientIds?: string[];
  frequency?: "daily" | "weekly" | "monthly";
  interval?: number;
  weekdays?: number[];
  monthDay?: number | null;
  timezone?: string;
  startDate?: string;
  endDate?: string | null;
  maxOccurrences?: number | null;
  missedPolicy?: "latest_only" | "all" | "skip";
  applyToCurrent?: boolean;
};

type TemplateRow = {
  id: string; title: string; description: string; created_by: string; audience_type: OrganizationTodoAudience;
  frequency: "daily" | "weekly" | "monthly"; interval: number; weekdays_json: string; month_day: number | null;
  rrule: string; timezone: string; start_date: string; end_date: string | null; max_occurrences: number | null;
  generated_count: number; missed_policy: "latest_only" | "all" | "skip"; paused: number;
  next_occurrence_date: string | null; created_at: string; updated_at: string; archived_at: string | null;
};
type OccurrenceRow = { id: string; template_id: string; title: string; description: string; audience_type: OrganizationTodoAudience; scheduled_for: string; status: "active" | "cancelled"; created_at: string; updated_at: string };
type AssignmentRow = { id: string; occurrence_id: string; user_id: string; user_name_snapshot: string; username_snapshot: string; status: "pending" | "completed" | "exempt"; completed_at: string | null; created_at: string; updated_at: string };
type ActiveUser = { id: string; name: string; username: string | null; role: string };
type JoinedAssignment = AssignmentRow & {
  title: string; description: string; audience_type: OrganizationTodoAudience; scheduled_for: string;
  occurrence_status: "active" | "cancelled"; template_id: string;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const weekdayMap: Record<number, Weekday> = { 1: RRule.MO, 2: RRule.TU, 3: RRule.WE, 4: RRule.TH, 5: RRule.FR, 6: RRule.SA, 7: RRule.SU };

export function ensureOrganizationTodoSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS todo_organization_templates (
      id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL,
      audience_type TEXT NOT NULL CHECK (audience_type IN ('all','custom')), frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
      interval INTEGER NOT NULL DEFAULT 1, weekdays_json TEXT NOT NULL DEFAULT '[]', month_day INTEGER, rrule TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai', start_date TEXT NOT NULL, end_date TEXT, max_occurrences INTEGER,
      generated_count INTEGER NOT NULL DEFAULT 0, missed_policy TEXT NOT NULL DEFAULT 'latest_only' CHECK (missed_policy IN ('latest_only','all','skip')),
      paused INTEGER NOT NULL DEFAULT 0, next_occurrence_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_todo_org_templates_active ON todo_organization_templates (archived_at, paused, next_occurrence_date)`,
    `CREATE TABLE IF NOT EXISTS todo_organization_template_recipients (
      template_id TEXT NOT NULL REFERENCES todo_organization_templates(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (template_id, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_todo_org_template_recipients_user ON todo_organization_template_recipients (user_id, template_id)`,
    `CREATE TABLE IF NOT EXISTS todo_organization_occurrences (
      id TEXT PRIMARY KEY NOT NULL, template_id TEXT NOT NULL REFERENCES todo_organization_templates(id) ON DELETE CASCADE,
      title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', audience_type TEXT NOT NULL CHECK (audience_type IN ('all','custom')),
      scheduled_for TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_todo_org_occurrence_schedule ON todo_organization_occurrences (template_id, scheduled_for)`,
    `CREATE INDEX IF NOT EXISTS idx_todo_org_occurrence_date ON todo_organization_occurrences (scheduled_for, status)`,
    `CREATE TABLE IF NOT EXISTS todo_organization_assignments (
      id TEXT PRIMARY KEY NOT NULL, occurrence_id TEXT NOT NULL REFERENCES todo_organization_occurrences(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL, user_name_snapshot TEXT NOT NULL, username_snapshot TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','exempt')), completed_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_todo_org_assignment_user ON todo_organization_assignments (occurrence_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_todo_org_assignment_dashboard ON todo_organization_assignments (user_id, status, occurrence_id)`,
    `CREATE INDEX IF NOT EXISTS idx_todo_org_assignment_progress ON todo_organization_assignments (occurrence_id, status)`,
  ];
  sqlite.transaction(() => { for (const statement of statements) sqlite.prepare(statement).run(); })();
}

function activeUsers() {
  return sqlite.prepare(`SELECT id, name, username, role FROM user WHERE COALESCE(banned, 0) = 0 ORDER BY name, username`).all() as ActiveUser[];
}

export function listOrganizationTodoUsers() {
  return activeUsers().map((user) => ({ id: user.id, name: user.name, username: user.username || "", role: user.role }));
}

function validTimezone(value: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}

function dateAtUtc(value: string) { return new Date(`${value}T12:00:00.000Z`); }
function dateKey(value: Date) { return value.toISOString().slice(0, 10); }

function normalizeInput(input: OrganizationTodoInput, fallback?: TemplateRow) {
  const timezone = input.timezone?.trim() || fallback?.timezone || "Asia/Shanghai";
  if (!validTimezone(timezone)) throw new Error("时区无效。");
  const title = input.title?.trim() || fallback?.title || "";
  if (!title || title.length > 160) throw new Error("任务名称应为 1 至 160 个字符。");
  const description = input.description === undefined ? fallback?.description || "" : input.description.trim();
  if (description.length > 2000) throw new Error("任务说明不能超过 2000 个字符。");
  const audienceType = input.audienceType || fallback?.audience_type || "all";
  if (!(["all", "custom"] as string[]).includes(audienceType)) throw new Error("接收范围无效。");
  const frequency = input.frequency || fallback?.frequency || "weekly";
  if (!(["daily", "weekly", "monthly"] as string[]).includes(frequency)) throw new Error("重复周期无效。");
  const interval = Math.floor(Number(input.interval ?? fallback?.interval ?? 1));
  if (interval < 1 || interval > 99) throw new Error("重复间隔应为 1 至 99。");
  const startDate = input.startDate || fallback?.start_date || todayInTimeZone(timezone);
  if (!datePattern.test(startDate)) throw new Error("开始日期无效。");
  const endDate = input.endDate === undefined ? fallback?.end_date || null : input.endDate;
  if (endDate && (!datePattern.test(endDate) || endDate < startDate)) throw new Error("结束日期不能早于开始日期。");
  const fallbackWeekdays = fallback ? JSON.parse(fallback.weekdays_json) as number[] : [dateAtUtc(startDate).getUTCDay() || 7];
  const weekdays = [...new Set((input.weekdays || fallbackWeekdays).map(Number))].filter((day) => day >= 1 && day <= 7).sort();
  if (frequency === "weekly" && !weekdays.length) throw new Error("每周任务至少选择一个星期。");
  const requestedMonthDay = input.monthDay === undefined ? fallback?.month_day : input.monthDay;
  const monthDay = frequency === "monthly" ? Number(requestedMonthDay ?? Number(startDate.slice(8, 10))) : null;
  if (monthDay !== null && monthDay !== -1 && (monthDay < 1 || monthDay > 31)) throw new Error("每月日期应为 1 至 31，或选择每月最后一天。");
  const rawMax = input.maxOccurrences === undefined ? fallback?.max_occurrences : input.maxOccurrences;
  const maxOccurrences = rawMax == null ? null : Math.floor(Number(rawMax));
  if (maxOccurrences !== null && (maxOccurrences < 1 || maxOccurrences > 10000)) throw new Error("执行次数应为 1 至 10000。");
  const missedPolicy = input.missedPolicy || fallback?.missed_policy || "latest_only";
  if (!(["latest_only", "all", "skip"] as string[]).includes(missedPolicy)) throw new Error("错过周期处理方式无效。");
  const recipientIds = [...new Set((input.recipientIds || []).map(String).filter(Boolean))];
  if (audienceType === "custom" && !fallback && !recipientIds.length) throw new Error("指定人员任务至少选择一名接收人。");
  return { title, description, audienceType, frequency, interval, weekdays, monthDay, timezone, startDate, endDate, maxOccurrences, missedPolicy, recipientIds };
}

function buildRule(input: ReturnType<typeof normalizeInput>) {
  const frequency = input.frequency === "daily" ? RRule.DAILY : input.frequency === "weekly" ? RRule.WEEKLY : RRule.MONTHLY;
  const options: Partial<Options> = { freq: frequency, interval: input.interval, dtstart: dateAtUtc(input.startDate) };
  if (input.endDate) options.until = dateAtUtc(input.endDate);
  if (input.frequency === "weekly") options.byweekday = input.weekdays.map((day) => weekdayMap[day]);
  if (input.frequency === "monthly") options.bymonthday = input.monthDay ?? Number(input.startDate.slice(8, 10));
  return new RRule(options).toString();
}

function nextRuleDate(ruleText: string, afterDate: string) {
  const next = rrulestr(ruleText).after(dateAtUtc(afterDate), false);
  return next ? dateKey(next) : null;
}

function recipientsForTemplate(template: TemplateRow) {
  const users = activeUsers();
  if (template.audience_type === "all") return users;
  const selected = new Set((sqlite.prepare("SELECT user_id FROM todo_organization_template_recipients WHERE template_id = ?").all(template.id) as Array<{ user_id: string }>).map((row) => row.user_id));
  return users.filter((user) => selected.has(user.id));
}

function createOccurrence(template: TemplateRow, scheduledFor: string) {
  return sqlite.transaction(() => {
    const now = new Date().toISOString();
    const occurrenceId = crypto.randomUUID();
    const created = sqlite.prepare(`INSERT OR IGNORE INTO todo_organization_occurrences
      (id, template_id, title, description, audience_type, scheduled_for, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`).run(occurrenceId, template.id, template.title, template.description, template.audience_type, scheduledFor, now, now);
    if (!created.changes) return 0;
    const insert = sqlite.prepare(`INSERT OR IGNORE INTO todo_organization_assignments
      (id, occurrence_id, user_id, user_name_snapshot, username_snapshot, status, completed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`);
    for (const user of recipientsForTemplate(template)) insert.run(crypto.randomUUID(), occurrenceId, user.id, user.name, user.username || "", now, now);
    return 1;
  })();
}

function reconcileInactiveAssignments() {
  const now = new Date().toISOString();
  sqlite.prepare(`UPDATE todo_organization_assignments AS assignment SET status = 'exempt', updated_at = ?
    WHERE assignment.status = 'pending' AND NOT EXISTS (
      SELECT 1 FROM user WHERE user.id = assignment.user_id AND COALESCE(user.banned, 0) = 0
    )`).run(now);
}

export function materializeOrganizationTodos(today = todayInTimeZone()) {
  ensureOrganizationTodoSchema();
  reconcileInactiveAssignments();
  const templates = sqlite.prepare(`SELECT * FROM todo_organization_templates WHERE archived_at IS NULL AND paused = 0`).all() as TemplateRow[];
  for (const template of templates) {
    const cursor = template.next_occurrence_date || template.start_date;
    if (!cursor || cursor > today) continue;
    const remaining = template.max_occurrences == null ? Number.MAX_SAFE_INTEGER : Math.max(0, template.max_occurrences - template.generated_count);
    if (!remaining) continue;
    const rule = rrulestr(template.rrule);
    let dueDates = rule.between(dateAtUtc(cursor), dateAtUtc(today), true).map(dateKey).filter((date) => date >= cursor);
    let nextCursor = nextRuleDate(template.rrule, today);
    if (template.missed_policy === "latest_only") dueDates = dueDates.length ? [dueDates.at(-1)!] : [];
    if (template.missed_policy === "skip") dueDates = dueDates.filter((date) => date === today);
    if (template.missed_policy === "all" && dueDates.length > 500) {
      dueDates = dueDates.slice(0, 500);
      nextCursor = nextRuleDate(template.rrule, dueDates.at(-1)!);
    }
    let generated = 0;
    for (const date of dueDates.slice(0, remaining)) generated += createOccurrence(template, date);
    sqlite.prepare(`UPDATE todo_organization_templates SET generated_count = generated_count + ?, next_occurrence_date = ?, updated_at = ? WHERE id = ?`)
      .run(generated, nextCursor, new Date().toISOString(), template.id);
  }
}

function progressForOccurrence(occurrenceId: string) {
  const rows = sqlite.prepare(`SELECT status, COUNT(*) AS total FROM todo_organization_assignments WHERE occurrence_id = ? GROUP BY status`).all(occurrenceId) as Array<{ status: AssignmentRow["status"]; total: number }>;
  const counts = Object.fromEntries(rows.map((row) => [row.status, Number(row.total)]));
  const completed = counts.completed || 0;
  const pending = counts.pending || 0;
  return { completed, pending, total: completed + pending, percent: completed + pending ? Math.round((completed / (completed + pending)) * 1000) / 10 : 0 };
}

function recipientIds(templateId: string) {
  return (sqlite.prepare("SELECT user_id FROM todo_organization_template_recipients WHERE template_id = ? ORDER BY user_id").all(templateId) as Array<{ user_id: string }>).map((row) => row.user_id);
}

function templateDto(row: TemplateRow) {
  const current = sqlite.prepare(`SELECT * FROM todo_organization_occurrences WHERE template_id = ? AND status = 'active' AND scheduled_for <= ? ORDER BY scheduled_for DESC LIMIT 1`).get(row.id, todayInTimeZone(row.timezone)) as OccurrenceRow | undefined;
  return {
    id: row.id, title: row.title, description: row.description, audienceType: row.audience_type,
    recipientIds: row.audience_type === "custom" ? recipientIds(row.id) : [], frequency: row.frequency, interval: row.interval,
    weekdays: JSON.parse(row.weekdays_json) as number[], monthDay: row.month_day, timezone: row.timezone,
    startDate: row.start_date, endDate: row.end_date, maxOccurrences: row.max_occurrences, generatedCount: row.generated_count,
    missedPolicy: row.missed_policy, paused: Boolean(row.paused), nextOccurrenceDate: row.next_occurrence_date,
    currentOccurrence: current ? { id: current.id, scheduledFor: current.scheduled_for, progress: progressForOccurrence(current.id) } : null,
    recipientCount: row.audience_type === "all" ? activeUsers().length : recipientsForTemplate(row).length,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function readOrganizationTodoAdminDashboard() {
  materializeOrganizationTodos();
  return {
    users: listOrganizationTodoUsers(),
    templates: (sqlite.prepare(`SELECT * FROM todo_organization_templates WHERE archived_at IS NULL ORDER BY paused, created_at DESC`).all() as TemplateRow[]).map(templateDto),
  };
}

function replaceRecipients(templateId: string, ids: string[]) {
  const active = new Set(activeUsers().map((user) => user.id));
  const selected = [...new Set(ids)].filter((id) => active.has(id));
  const now = new Date().toISOString();
  sqlite.prepare("DELETE FROM todo_organization_template_recipients WHERE template_id = ?").run(templateId);
  const insert = sqlite.prepare("INSERT INTO todo_organization_template_recipients (template_id, user_id, created_at) VALUES (?, ?, ?)");
  for (const id of selected) insert.run(templateId, id, now);
  return selected;
}

export function createOrganizationTodoTemplate(actorId: string, input: OrganizationTodoInput) {
  ensureOrganizationTodoSchema();
  const value = normalizeInput(input);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO todo_organization_templates
      (id, title, description, created_by, audience_type, frequency, interval, weekdays_json, month_day, rrule, timezone,
       start_date, end_date, max_occurrences, generated_count, missed_policy, paused, next_occurrence_date, created_at, updated_at, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, NULL)`)
      .run(id, value.title, value.description, actorId, value.audienceType, value.frequency, value.interval, JSON.stringify(value.weekdays), value.monthDay,
        buildRule(value), value.timezone, value.startDate, value.endDate, value.maxOccurrences, value.missedPolicy, value.startDate, now, now);
    if (value.audienceType === "custom") {
      const selected = replaceRecipients(id, value.recipientIds);
      if (!selected.length) throw new Error("指定人员任务至少选择一名有效接收人。");
    }
  })();
  materializeOrganizationTodos(todayInTimeZone(value.timezone));
  return templateDto(sqlite.prepare("SELECT * FROM todo_organization_templates WHERE id = ?").get(id) as TemplateRow);
}

function applyRecipientsToCurrent(template: TemplateRow) {
  const occurrence = sqlite.prepare(`SELECT * FROM todo_organization_occurrences WHERE template_id = ? AND status = 'active' AND scheduled_for <= ? ORDER BY scheduled_for DESC LIMIT 1`)
    .get(template.id, todayInTimeZone(template.timezone)) as OccurrenceRow | undefined;
  if (!occurrence) return;
  const targets = recipientsForTemplate(template);
  const targetIds = new Set(targets.map((user) => user.id));
  const now = new Date().toISOString();
  const rows = sqlite.prepare("SELECT * FROM todo_organization_assignments WHERE occurrence_id = ?").all(occurrence.id) as AssignmentRow[];
  for (const row of rows) if (!targetIds.has(row.user_id) && row.status !== "exempt") sqlite.prepare("UPDATE todo_organization_assignments SET status = 'exempt', updated_at = ? WHERE id = ?").run(now, row.id);
  const insert = sqlite.prepare(`INSERT OR IGNORE INTO todo_organization_assignments
    (id, occurrence_id, user_id, user_name_snapshot, username_snapshot, status, completed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`);
  for (const user of targets) insert.run(crypto.randomUUID(), occurrence.id, user.id, user.name, user.username || "", now, now);
}

export function updateOrganizationTodoTemplate(id: string, input: OrganizationTodoInput) {
  ensureOrganizationTodoSchema();
  const current = sqlite.prepare("SELECT * FROM todo_organization_templates WHERE id = ? AND archived_at IS NULL").get(id) as TemplateRow | undefined;
  if (!current) return null;
  const value = normalizeInput(input, current);
  const suppliedRecipients = input.recipientIds !== undefined;
  if (value.audienceType === "custom" && !suppliedRecipients) value.recipientIds = recipientIds(id);
  const now = new Date().toISOString();
  sqlite.transaction(() => {
    const existing = sqlite.prepare("SELECT COUNT(*) AS total FROM todo_organization_occurrences WHERE template_id = ?").get(id) as { total: number };
    sqlite.prepare(`UPDATE todo_organization_templates SET title = ?, description = ?, audience_type = ?, frequency = ?, interval = ?, weekdays_json = ?,
      month_day = ?, rrule = ?, timezone = ?, start_date = ?, end_date = ?, max_occurrences = ?, generated_count = ?, missed_policy = ?,
      next_occurrence_date = ?, updated_at = ? WHERE id = ?`)
      .run(value.title, value.description, value.audienceType, value.frequency, value.interval, JSON.stringify(value.weekdays), value.monthDay,
        buildRule(value), value.timezone, value.startDate, value.endDate, value.maxOccurrences, Number(existing.total), value.missedPolicy, value.startDate, now, id);
    if (value.audienceType === "custom") {
      const selected = replaceRecipients(id, value.recipientIds);
      if (!selected.length) throw new Error("指定人员任务至少选择一名有效接收人。");
    } else replaceRecipients(id, []);
    if (input.applyToCurrent) applyRecipientsToCurrent(sqlite.prepare("SELECT * FROM todo_organization_templates WHERE id = ?").get(id) as TemplateRow);
  })();
  materializeOrganizationTodos(todayInTimeZone(value.timezone));
  return templateDto(sqlite.prepare("SELECT * FROM todo_organization_templates WHERE id = ?").get(id) as TemplateRow);
}

export function setOrganizationTodoPaused(id: string, paused: boolean) {
  ensureOrganizationTodoSchema();
  const result = sqlite.prepare("UPDATE todo_organization_templates SET paused = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL")
    .run(paused ? 1 : 0, new Date().toISOString(), id);
  if (result.changes && !paused) materializeOrganizationTodos();
  return Boolean(result.changes);
}

export function archiveOrganizationTodo(id: string) {
  ensureOrganizationTodoSchema();
  const now = new Date().toISOString();
  return Boolean(sqlite.prepare("UPDATE todo_organization_templates SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL").run(now, now, id).changes);
}

function organizationItem(row: JoinedAssignment) {
  return {
    id: row.id, recurrenceTemplateId: null, organizationOccurrenceId: row.occurrence_id, source: "organization" as const,
    title: row.title, description: row.description, audienceType: row.audience_type, scheduledFor: row.scheduled_for,
    status: row.status, completedAt: row.completed_at, createdAt: row.created_at, updatedAt: row.updated_at,
    overdueDays: 0, progress: progressForOccurrence(row.occurrence_id),
  };
}

function assignmentWithOccurrence(id: string) {
  return sqlite.prepare(`SELECT assignment.*, occurrence.title, occurrence.description, occurrence.audience_type, occurrence.scheduled_for,
      occurrence.status AS occurrence_status, occurrence.template_id
    FROM todo_organization_assignments assignment JOIN todo_organization_occurrences occurrence ON occurrence.id = assignment.occurrence_id
    WHERE assignment.id = ?`).get(id) as JoinedAssignment | undefined;
}

function daysBetween(later: string, earlier: string) { return Math.max(0, Math.floor((dateAtUtc(later).getTime() - dateAtUtc(earlier).getTime()) / 86_400_000)); }

export function readOrganizationTodoDashboard(userId: string, timezone = "Asia/Shanghai") {
  const today = todayInTimeZone(timezone);
  materializeOrganizationTodos(today);
  const rows = sqlite.prepare(`SELECT assignment.*, occurrence.title, occurrence.description, occurrence.audience_type, occurrence.scheduled_for,
      occurrence.status AS occurrence_status, occurrence.template_id
    FROM todo_organization_assignments assignment JOIN todo_organization_occurrences occurrence ON occurrence.id = assignment.occurrence_id
    WHERE assignment.user_id = ? AND assignment.status IN ('pending','completed') AND occurrence.status = 'active'
    ORDER BY occurrence.scheduled_for DESC, assignment.created_at DESC LIMIT 500`).all(userId) as JoinedAssignment[];
  const items = rows.map((row) => ({ ...organizationItem(row), overdueDays: row.status === "pending" && row.scheduled_for < today ? daysBetween(today, row.scheduled_for) : 0 }));
  const completedToday = items.filter((item) => item.status === "completed" && item.completedAt && todayInTimeZone(timezone, new Date(item.completedAt)) === today);
  const todayItems = [...items.filter((item) => item.status === "pending" && item.scheduledFor <= today), ...completedToday].sort((left, right) => {
    const leftRank = left.status === "completed" ? 2 : left.scheduledFor < today ? 0 : 1;
    const rightRank = right.status === "completed" ? 2 : right.scheduledFor < today ? 0 : 1;
    return leftRank - rightRank || left.scheduledFor.localeCompare(right.scheduledFor);
  });
  return {
    todayItems,
    overdueItems: items.filter((item) => item.status === "pending" && item.scheduledFor < today),
    historyItems: items.filter((item) => item.status === "completed").sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))),
    organizationItems: items,
  };
}

export function updateOrganizationTodoAssignment(userId: string, id: string, action: "complete" | "reopen") {
  ensureOrganizationTodoSchema();
  const row = assignmentWithOccurrence(id);
  if (!row || row.user_id !== userId || row.status === "exempt" || row.occurrence_status !== "active") return null;
  const now = new Date().toISOString();
  sqlite.prepare("UPDATE todo_organization_assignments SET status = ?, completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(action === "complete" ? "completed" : "pending", action === "complete" ? now : null, now, id, userId);
  const updated = assignmentWithOccurrence(id)!;
  const today = todayInTimeZone();
  return { ...organizationItem(updated), overdueDays: updated.status === "pending" && updated.scheduled_for < today ? daysBetween(today, updated.scheduled_for) : 0 };
}

export function readOrganizationTodoOccurrence(userId: string, role: string, occurrenceId: string) {
  ensureOrganizationTodoSchema();
  reconcileInactiveAssignments();
  const occurrence = sqlite.prepare("SELECT * FROM todo_organization_occurrences WHERE id = ?").get(occurrenceId) as OccurrenceRow | undefined;
  if (!occurrence) return null;
  const own = sqlite.prepare("SELECT 1 FROM todo_organization_assignments WHERE occurrence_id = ? AND user_id = ? AND status <> 'exempt'").get(occurrenceId, userId);
  if (role !== "admin" && !own) return false;
  const rows = sqlite.prepare("SELECT * FROM todo_organization_assignments WHERE occurrence_id = ? ORDER BY user_name_snapshot, username_snapshot").all(occurrenceId) as AssignmentRow[];
  const person = (row: AssignmentRow) => ({ id: row.user_id, name: row.user_name_snapshot, username: row.username_snapshot, completedAt: row.completed_at, isCurrentUser: row.user_id === userId });
  return {
    id: occurrence.id, title: occurrence.title, description: occurrence.description, audienceType: occurrence.audience_type,
    scheduledFor: occurrence.scheduled_for, status: occurrence.status, progress: progressForOccurrence(occurrence.id),
    completed: rows.filter((row) => row.status === "completed").map(person),
    pending: rows.filter((row) => row.status === "pending").map(person),
    exempt: role === "admin" ? rows.filter((row) => row.status === "exempt").map(person) : [],
    canManage: role === "admin",
  };
}
