import { type Options, type Weekday } from "rrule";
import rrulePackage from "rrule/dist/es5/rrule.js";
import { sqlite } from "./local";

const { RRule, rrulestr } = rrulePackage;

export type TodoFrequency = "daily" | "weekly" | "monthly";
export type TodoRecurrenceMode = "calendar" | "after_completion";
export type TodoMissedPolicy = "latest_only" | "all" | "skip";
export type TodoItemStatus = "pending" | "completed" | "skipped";

export type TodoTemplateInput = {
  title?: string;
  frequency?: TodoFrequency;
  interval?: number;
  weekdays?: number[];
  monthDay?: number | null;
  recurrenceMode?: TodoRecurrenceMode;
  timezone?: string;
  startDate?: string;
  endDate?: string | null;
  maxOccurrences?: number | null;
  missedPolicy?: TodoMissedPolicy;
  waitForCompletion?: boolean;
};

type TodoTemplateRow = {
  id: string;
  user_id: string;
  title: string;
  frequency: TodoFrequency;
  interval: number;
  weekdays_json: string;
  month_day: number | null;
  recurrence_mode: TodoRecurrenceMode;
  rrule: string;
  timezone: string;
  start_date: string;
  end_date: string | null;
  max_occurrences: number | null;
  generated_count: number;
  missed_policy: TodoMissedPolicy;
  wait_for_completion: number;
  paused: number;
  next_occurrence_date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type TodoItemRow = {
  id: string;
  user_id: string;
  recurrence_template_id: string | null;
  source: "temporary" | "recurring";
  title: string;
  scheduled_for: string;
  status: TodoItemStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const weekdayMap: Record<number, Weekday> = {
  1: RRule.MO, 2: RRule.TU, 3: RRule.WE, 4: RRule.TH,
  5: RRule.FR, 6: RRule.SA, 7: RRule.SU,
};

export function ensureTodoSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS todo_recurrence_templates (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
      interval INTEGER NOT NULL DEFAULT 1,
      weekdays_json TEXT NOT NULL DEFAULT '[]',
      month_day INTEGER,
      recurrence_mode TEXT NOT NULL DEFAULT 'calendar' CHECK (recurrence_mode IN ('calendar','after_completion')),
      rrule TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      start_date TEXT NOT NULL,
      end_date TEXT,
      max_occurrences INTEGER,
      generated_count INTEGER NOT NULL DEFAULT 0,
      missed_policy TEXT NOT NULL DEFAULT 'latest_only' CHECK (missed_policy IN ('latest_only','all','skip')),
      wait_for_completion INTEGER NOT NULL DEFAULT 0,
      paused INTEGER NOT NULL DEFAULT 0,
      next_occurrence_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_todo_templates_user_active
      ON todo_recurrence_templates (user_id, deleted_at, paused)`,
    `CREATE INDEX IF NOT EXISTS idx_todo_templates_user_next
      ON todo_recurrence_templates (user_id, next_occurrence_date)`,
    `CREATE TABLE IF NOT EXISTS todo_items (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      recurrence_template_id TEXT REFERENCES todo_recurrence_templates(id) ON DELETE SET NULL,
      source TEXT NOT NULL CHECK (source IN ('temporary','recurring')),
      title TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','skipped')),
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_todo_items_template_occurrence
      ON todo_items (recurrence_template_id, scheduled_for)`,
    `CREATE INDEX IF NOT EXISTS idx_todo_items_user_status_due
      ON todo_items (user_id, status, scheduled_for)`,
    `CREATE INDEX IF NOT EXISTS idx_todo_items_user_completed
      ON todo_items (user_id, completed_at)`,
    `CREATE INDEX IF NOT EXISTS idx_todo_items_user_source
      ON todo_items (user_id, source, scheduled_for)`,
  ];
  const initialize = sqlite.transaction(() => {
    for (const statement of statements) sqlite.prepare(statement).run();
    sqlite.pragma("optimize");
  });
  initialize();
}

export function todayInTimeZone(timezone = "Asia/Shanghai", now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function dateAtUtc(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, amount: number) {
  const date = dateAtUtc(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKey(date);
}

function addMonthsClamped(value: string, amount: number) {
  const source = dateAtUtc(value);
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth() + amount;
  const day = source.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0, 12)).getUTCDate();
  return dateKey(new Date(Date.UTC(year, month, Math.min(day, lastDay), 12)));
}

function dayDifference(later: string, earlier: string) {
  return Math.max(0, Math.floor((dateAtUtc(later).getTime() - dateAtUtc(earlier).getTime()) / 86_400_000));
}

function validTimezone(value: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; }
  catch { return false; }
}

function normalizeTemplateInput(input: TodoTemplateInput, fallback?: TodoTemplateRow) {
  const timezone = input.timezone?.trim() || fallback?.timezone || "Asia/Shanghai";
  if (!validTimezone(timezone)) throw new Error("时区无效。");
  const title = input.title?.trim() || fallback?.title || "";
  if (!title || title.length > 160) throw new Error("任务名称应为 1 至 160 个字符。");
  const frequency = input.frequency || fallback?.frequency || "daily";
  if (!["daily", "weekly", "monthly"].includes(frequency)) throw new Error("重复周期无效。");
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
  const recurrenceMode = input.recurrenceMode || fallback?.recurrence_mode || "calendar";
  if (!["calendar", "after_completion"].includes(recurrenceMode)) throw new Error("下一期计算方式无效。");
  const missedPolicy = input.missedPolicy || fallback?.missed_policy || "latest_only";
  if (!["latest_only", "all", "skip"].includes(missedPolicy)) throw new Error("错过任务处理方式无效。");
  const rawMax = input.maxOccurrences === undefined ? fallback?.max_occurrences : input.maxOccurrences;
  const maxOccurrences = rawMax == null ? null : Math.floor(Number(rawMax));
  if (maxOccurrences !== null && (maxOccurrences < 1 || maxOccurrences > 10000)) throw new Error("完成次数应为 1 至 10000。");
  const waitForCompletion = input.waitForCompletion ?? (fallback ? Boolean(fallback.wait_for_completion) : recurrenceMode === "after_completion");
  return { title, frequency, interval, weekdays, monthDay, recurrenceMode, timezone, startDate, endDate, maxOccurrences, missedPolicy, waitForCompletion };
}

function buildRule(input: ReturnType<typeof normalizeTemplateInput>) {
  const frequency = input.frequency === "daily" ? RRule.DAILY : input.frequency === "weekly" ? RRule.WEEKLY : RRule.MONTHLY;
  const options: Partial<Options> = { freq: frequency, interval: input.interval, dtstart: dateAtUtc(input.startDate) };
  if (input.endDate) options.until = dateAtUtc(input.endDate);
  if (input.frequency === "weekly") options.byweekday = input.weekdays.map((day) => weekdayMap[day]);
  if (input.frequency === "monthly") options.bymonthday = input.monthDay ?? Number(input.startDate.slice(8, 10));
  return new RRule(options).toString();
}

function insertOccurrence(template: TodoTemplateRow, scheduledFor: string) {
  const now = new Date().toISOString();
  const result = sqlite.prepare(`INSERT OR IGNORE INTO todo_items
    (id, user_id, recurrence_template_id, source, title, scheduled_for, status, completed_at, created_at, updated_at)
    VALUES (?, ?, ?, 'recurring', ?, ?, 'pending', NULL, ?, ?)`)
    .run(crypto.randomUUID(), template.user_id, template.id, template.title, scheduledFor, now, now);
  return Number(result.changes || 0);
}

function nextRuleDate(ruleText: string, afterDate: string) {
  const next = rrulestr(ruleText).after(dateAtUtc(afterDate), false);
  return next ? dateKey(next) : null;
}

function materializeCalendarTemplate(template: TodoTemplateRow, today: string) {
  if (template.paused || template.deleted_at) return;
  if (template.wait_for_completion) {
    const pending = sqlite.prepare("SELECT 1 FROM todo_items WHERE recurrence_template_id = ? AND status = 'pending' LIMIT 1").get(template.id);
    if (pending) return;
  }
  const rule = rrulestr(template.rrule);
  let cursor = template.next_occurrence_date || template.start_date;
  let generated = 0;
  const remaining = template.max_occurrences == null ? Number.MAX_SAFE_INTEGER : Math.max(0, template.max_occurrences - template.generated_count);
  if (!remaining) return;
  if (cursor <= today) {
    let dueDates = rule.between(dateAtUtc(cursor), dateAtUtc(today), true).map(dateKey).filter((date) => date >= cursor);
    let nextCursor = nextRuleDate(template.rrule, today);
    if (template.missed_policy === "latest_only") dueDates = dueDates.length ? [dueDates.at(-1)!] : [];
    if (template.missed_policy === "skip") dueDates = dueDates.filter((date) => date === today);
    if (template.missed_policy === "all" && dueDates.length > 500) {
      dueDates = dueDates.slice(0, 500);
      nextCursor = nextRuleDate(template.rrule, dueDates.at(-1)!);
    }
    for (const date of dueDates.slice(0, remaining)) generated += insertOccurrence(template, date);
    cursor = nextCursor || "";
  }
  const futurePending = sqlite.prepare(`SELECT 1 FROM todo_items
    WHERE recurrence_template_id = ? AND status = 'pending' AND scheduled_for > ? LIMIT 1`).get(template.id, today);
  if (!futurePending && cursor && template.generated_count + generated < (template.max_occurrences ?? Number.MAX_SAFE_INTEGER)) {
    generated += insertOccurrence(template, cursor);
    cursor = nextRuleDate(template.rrule, cursor) || "";
  }
  sqlite.prepare(`UPDATE todo_recurrence_templates
    SET generated_count = generated_count + ?, next_occurrence_date = ?, updated_at = ? WHERE id = ?`)
    .run(generated, cursor || null, new Date().toISOString(), template.id);
}

function materializeCompletionTemplate(template: TodoTemplateRow) {
  if (template.paused || template.deleted_at) return;
  const existing = sqlite.prepare("SELECT 1 FROM todo_items WHERE recurrence_template_id = ? LIMIT 1").get(template.id);
  if (!existing && (template.max_occurrences == null || template.generated_count < template.max_occurrences)) {
    const generated = insertOccurrence(template, template.start_date);
    sqlite.prepare("UPDATE todo_recurrence_templates SET generated_count = generated_count + ?, next_occurrence_date = NULL, updated_at = ? WHERE id = ?")
      .run(generated, new Date().toISOString(), template.id);
  }
}

export function materializeUserTodoInstances(userId: string, today = todayInTimeZone()) {
  ensureTodoSchema();
  const templates = sqlite.prepare(`SELECT * FROM todo_recurrence_templates
    WHERE user_id = ? AND deleted_at IS NULL AND paused = 0`).all(userId) as TodoTemplateRow[];
  for (const template of templates) {
    if (template.recurrence_mode === "after_completion") materializeCompletionTemplate(template);
    else materializeCalendarTemplate(template, today);
  }
}

function templateDto(row: TodoTemplateRow) {
  return {
    id: row.id, title: row.title, frequency: row.frequency, interval: row.interval,
    weekdays: JSON.parse(row.weekdays_json) as number[], monthDay: row.month_day,
    recurrenceMode: row.recurrence_mode, rrule: row.rrule, timezone: row.timezone,
    startDate: row.start_date, endDate: row.end_date, maxOccurrences: row.max_occurrences,
    generatedCount: row.generated_count, missedPolicy: row.missed_policy,
    waitForCompletion: Boolean(row.wait_for_completion), paused: Boolean(row.paused),
    nextOccurrenceDate: row.next_occurrence_date, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function itemDto(row: TodoItemRow, today: string) {
  return {
    id: row.id, recurrenceTemplateId: row.recurrence_template_id, source: row.source,
    title: row.title, scheduledFor: row.scheduled_for, status: row.status,
    completedAt: row.completed_at, createdAt: row.created_at, updatedAt: row.updated_at,
    overdueDays: row.status === "pending" && row.scheduled_for < today ? dayDifference(today, row.scheduled_for) : 0,
  };
}

export function readTodoDashboard(userId: string, timezone = "Asia/Shanghai") {
  ensureTodoSchema();
  const today = todayInTimeZone(timezone);
  materializeUserTodoInstances(userId, today);
  const pending = sqlite.prepare(`SELECT * FROM todo_items
    WHERE user_id = ? AND status = 'pending' AND scheduled_for <= ?`).all(userId, today) as TodoItemRow[];
  const completed = sqlite.prepare(`SELECT * FROM todo_items
    WHERE user_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 200`).all(userId) as TodoItemRow[];
  const completedToday = completed.filter((row) => row.completed_at && todayInTimeZone(timezone, new Date(row.completed_at)) === today);
  const todayItems = [...pending, ...completedToday].sort((left, right) => {
    const leftRank = left.status === "completed" ? 2 : left.scheduled_for < today ? 0 : 1;
    const rightRank = right.status === "completed" ? 2 : right.scheduled_for < today ? 0 : 1;
    return leftRank - rightRank || left.scheduled_for.localeCompare(right.scheduled_for) || left.created_at.localeCompare(right.created_at);
  });
  const templates = sqlite.prepare(`SELECT * FROM todo_recurrence_templates
    WHERE user_id = ? AND deleted_at IS NULL ORDER BY paused, created_at DESC`).all(userId) as TodoTemplateRow[];
  const temporary = sqlite.prepare(`SELECT * FROM todo_items
    WHERE user_id = ? AND source = 'temporary' ORDER BY scheduled_for DESC, created_at DESC LIMIT 500`).all(userId) as TodoItemRow[];
  return {
    today,
    todayItems: todayItems.map((row) => itemDto(row, today)),
    overdueItems: pending.filter((row) => row.scheduled_for < today).map((row) => itemDto(row, today)),
    historyItems: completed.map((row) => itemDto(row, today)),
    temporaryItems: temporary.map((row) => itemDto(row, today)),
    templates: templates.map(templateDto),
  };
}

export function createTemporaryTodo(userId: string, titleValue: string, scheduledFor = todayInTimeZone()) {
  ensureTodoSchema();
  const title = titleValue.trim();
  if (!title || title.length > 160) throw new Error("待办名称应为 1 至 160 个字符。");
  if (!datePattern.test(scheduledFor)) throw new Error("截止日期无效。");
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  sqlite.prepare(`INSERT INTO todo_items
    (id, user_id, recurrence_template_id, source, title, scheduled_for, status, completed_at, created_at, updated_at)
    VALUES (?, ?, NULL, 'temporary', ?, ?, 'pending', NULL, ?, ?)`)
    .run(id, userId, title, scheduledFor, now, now);
  return itemDto(sqlite.prepare("SELECT * FROM todo_items WHERE id = ? AND user_id = ?").get(id, userId) as TodoItemRow, todayInTimeZone());
}

export function createTodoTemplate(userId: string, input: TodoTemplateInput) {
  ensureTodoSchema();
  const value = normalizeTemplateInput(input);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  sqlite.prepare(`INSERT INTO todo_recurrence_templates
    (id, user_id, title, frequency, interval, weekdays_json, month_day, recurrence_mode, rrule, timezone,
      start_date, end_date, max_occurrences, generated_count, missed_policy, wait_for_completion, paused,
      next_occurrence_date, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, NULL)`)
    .run(id, userId, value.title, value.frequency, value.interval, JSON.stringify(value.weekdays), value.monthDay,
      value.recurrenceMode, buildRule(value), value.timezone, value.startDate, value.endDate, value.maxOccurrences,
      value.missedPolicy, value.waitForCompletion ? 1 : 0, value.startDate, now, now);
  materializeUserTodoInstances(userId, todayInTimeZone(value.timezone));
  return templateDto(sqlite.prepare("SELECT * FROM todo_recurrence_templates WHERE id = ? AND user_id = ?").get(id, userId) as TodoTemplateRow);
}

export function updateTodoTemplate(userId: string, id: string, input: TodoTemplateInput) {
  ensureTodoSchema();
  const current = sqlite.prepare("SELECT * FROM todo_recurrence_templates WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(id, userId) as TodoTemplateRow | undefined;
  if (!current) return null;
  const value = normalizeTemplateInput(input, current);
  const now = new Date().toISOString();
  const update = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM todo_items WHERE recurrence_template_id = ? AND user_id = ? AND status = 'pending'").run(id, userId);
    const history = sqlite.prepare("SELECT COUNT(*) AS total FROM todo_items WHERE recurrence_template_id = ? AND user_id = ? AND status = 'completed'").get(id, userId) as { total: number };
    sqlite.prepare(`UPDATE todo_recurrence_templates SET title = ?, frequency = ?, interval = ?, weekdays_json = ?, month_day = ?,
      recurrence_mode = ?, rrule = ?, timezone = ?, start_date = ?, end_date = ?, max_occurrences = ?, generated_count = ?,
      missed_policy = ?, wait_for_completion = ?, next_occurrence_date = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(value.title, value.frequency, value.interval, JSON.stringify(value.weekdays), value.monthDay, value.recurrenceMode,
        buildRule(value), value.timezone, value.startDate, value.endDate, value.maxOccurrences, Number(history.total),
        value.missedPolicy, value.waitForCompletion ? 1 : 0, value.startDate, now, id, userId);
  });
  update();
  materializeUserTodoInstances(userId, todayInTimeZone(value.timezone));
  return templateDto(sqlite.prepare("SELECT * FROM todo_recurrence_templates WHERE id = ? AND user_id = ?").get(id, userId) as TodoTemplateRow);
}

export function setTodoTemplatePaused(userId: string, id: string, paused: boolean) {
  ensureTodoSchema();
  const result = sqlite.prepare(`UPDATE todo_recurrence_templates SET paused = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL`).run(paused ? 1 : 0, new Date().toISOString(), id, userId);
  if (!result.changes) return false;
  if (!paused) materializeUserTodoInstances(userId);
  return true;
}

export function deleteTodoTemplate(userId: string, id: string) {
  ensureTodoSchema();
  const now = new Date().toISOString();
  return sqlite.transaction(() => {
    const result = sqlite.prepare(`UPDATE todo_recurrence_templates SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`).run(now, now, id, userId);
    if (!result.changes) return false;
    sqlite.prepare("DELETE FROM todo_items WHERE recurrence_template_id = ? AND user_id = ? AND status = 'pending'").run(id, userId);
    return true;
  })();
}

function scheduleAfterCompletion(template: TodoTemplateRow, completedDate: string) {
  if (template.paused || template.deleted_at) return;
  if (template.max_occurrences !== null && template.generated_count >= template.max_occurrences) return;
  const nextDate = template.frequency === "daily" ? addDays(completedDate, template.interval)
    : template.frequency === "weekly" ? addDays(completedDate, template.interval * 7)
      : addMonthsClamped(completedDate, template.interval);
  if (template.end_date && nextDate > template.end_date) return;
  const generated = insertOccurrence(template, nextDate);
  sqlite.prepare("UPDATE todo_recurrence_templates SET generated_count = generated_count + ?, next_occurrence_date = NULL, updated_at = ? WHERE id = ?")
    .run(generated, new Date().toISOString(), template.id);
}

export function updateTodoItem(userId: string, id: string, input: { action?: "complete" | "reopen"; title?: string; scheduledFor?: string }) {
  ensureTodoSchema();
  const row = sqlite.prepare("SELECT * FROM todo_items WHERE id = ? AND user_id = ?").get(id, userId) as TodoItemRow | undefined;
  if (!row) return null;
  const now = new Date().toISOString();
  if (input.action === "complete") {
    sqlite.prepare("UPDATE todo_items SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(now, now, id, userId);
    if (row.recurrence_template_id) {
      const template = sqlite.prepare("SELECT * FROM todo_recurrence_templates WHERE id = ? AND user_id = ?").get(row.recurrence_template_id, userId) as TodoTemplateRow | undefined;
      if (template?.recurrence_mode === "after_completion") scheduleAfterCompletion(template, todayInTimeZone(template.timezone));
    }
  } else if (input.action === "reopen") {
    sqlite.prepare("UPDATE todo_items SET status = 'pending', completed_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(now, id, userId);
    if (row.recurrence_template_id) {
      const template = sqlite.prepare("SELECT * FROM todo_recurrence_templates WHERE id = ? AND user_id = ?").get(row.recurrence_template_id, userId) as TodoTemplateRow | undefined;
      if (template?.recurrence_mode === "after_completion") {
        sqlite.prepare("DELETE FROM todo_items WHERE recurrence_template_id = ? AND user_id = ? AND status = 'pending' AND scheduled_for > ?")
          .run(template.id, userId, row.scheduled_for);
      }
    }
  } else {
    if (row.source !== "temporary") throw new Error("周期实例请通过周期任务设置修改。");
    const title = input.title?.trim() || row.title;
    const scheduledFor = input.scheduledFor || row.scheduled_for;
    if (!title || title.length > 160 || !datePattern.test(scheduledFor)) throw new Error("临时待办内容无效。");
    sqlite.prepare("UPDATE todo_items SET title = ?, scheduled_for = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(title, scheduledFor, now, id, userId);
  }
  return itemDto(sqlite.prepare("SELECT * FROM todo_items WHERE id = ? AND user_id = ?").get(id, userId) as TodoItemRow, todayInTimeZone());
}

export function deleteTodoItem(userId: string, id: string) {
  ensureTodoSchema();
  const result = sqlite.prepare("DELETE FROM todo_items WHERE id = ? AND user_id = ? AND source = 'temporary'").run(id, userId);
  return Boolean(result.changes);
}
