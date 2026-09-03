import { type Options, type Weekday } from "rrule";
import rrulePackage from "rrule/dist/es5/rrule.js";

const { RRule, rrulestr } = rrulePackage;

export type TodoFrequency = "daily" | "weekly" | "monthly";
export type TodoMissedPolicy = "latest_only" | "all" | "skip";

export type CommonRecurrenceInput = {
  frequency?: TodoFrequency;
  interval?: number;
  weekdays?: number[];
  monthDay?: number | null;
  timezone?: string;
  startDate?: string;
  endDate?: string | null;
  maxOccurrences?: number | null;
  missedPolicy?: TodoMissedPolicy;
};

export type RecurrenceFallback = {
  frequency: TodoFrequency;
  interval: number;
  weekdays: number[];
  monthDay: number | null;
  timezone: string;
  startDate: string;
  endDate: string | null;
  maxOccurrences: number | null;
  missedPolicy: TodoMissedPolicy;
};

export type NormalizedRecurrence = Required<Omit<CommonRecurrenceInput, "endDate" | "maxOccurrences">> & {
  endDate: string | null;
  maxOccurrences: number | null;
};

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const weekdayMap: Record<number, Weekday> = {
  1: RRule.MO,
  2: RRule.TU,
  3: RRule.WE,
  4: RRule.TH,
  5: RRule.FR,
  6: RRule.SA,
  7: RRule.SU,
};

export function todayInTimeZone(timezone = "Asia/Shanghai", now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function dateAtUtc(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

export function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function addDays(value: string, amount: number) {
  const date = dateAtUtc(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKey(date);
}

export function addMonthsClamped(value: string, amount: number) {
  const source = dateAtUtc(value);
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth() + amount;
  const day = source.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0, 12)).getUTCDate();
  return dateKey(new Date(Date.UTC(year, month, Math.min(day, lastDay), 12)));
}

export function daysBetween(later: string, earlier: string) {
  return Math.max(0, Math.floor((dateAtUtc(later).getTime() - dateAtUtc(earlier).getTime()) / 86_400_000));
}

function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function normalizeRecurrenceInput(
  input: CommonRecurrenceInput,
  fallback: RecurrenceFallback | undefined,
  options: {
    defaultFrequency: TodoFrequency;
    maxOccurrencesError: string;
    missedPolicyError: string;
  },
): NormalizedRecurrence {
  const timezone = input.timezone?.trim() || fallback?.timezone || "Asia/Shanghai";
  if (!validTimezone(timezone)) throw new Error("时区无效。");

  const frequency = input.frequency || fallback?.frequency || options.defaultFrequency;
  if (!("daily weekly monthly".split(" ") as string[]).includes(frequency)) throw new Error("重复周期无效。");

  const interval = Math.floor(Number(input.interval ?? fallback?.interval ?? 1));
  if (interval < 1 || interval > 99) throw new Error("重复间隔应为 1 至 99。");

  const startDate = input.startDate || fallback?.startDate || todayInTimeZone(timezone);
  if (!DATE_PATTERN.test(startDate)) throw new Error("开始日期无效。");
  const endDate = input.endDate === undefined ? fallback?.endDate || null : input.endDate;
  if (endDate && (!DATE_PATTERN.test(endDate) || endDate < startDate)) throw new Error("结束日期不能早于开始日期。");

  const defaultWeekdays = fallback?.weekdays ?? [dateAtUtc(startDate).getUTCDay() || 7];
  const weekdays = [...new Set((input.weekdays || defaultWeekdays).map(Number))].filter((day) => day >= 1 && day <= 7).sort();
  if (frequency === "weekly" && !weekdays.length) throw new Error("每周任务至少选择一个星期。");

  const requestedMonthDay = input.monthDay === undefined ? fallback?.monthDay : input.monthDay;
  const monthDay = frequency === "monthly" ? Number(requestedMonthDay ?? Number(startDate.slice(8, 10))) : null;
  if (monthDay !== null && monthDay !== -1 && (monthDay < 1 || monthDay > 31)) throw new Error("每月日期应为 1 至 31，或选择每月最后一天。");

  const rawMax = input.maxOccurrences === undefined ? fallback?.maxOccurrences : input.maxOccurrences;
  const maxOccurrences = rawMax == null ? null : Math.floor(Number(rawMax));
  if (maxOccurrences !== null && (maxOccurrences < 1 || maxOccurrences > 10000)) throw new Error(options.maxOccurrencesError);

  const missedPolicy = input.missedPolicy || fallback?.missedPolicy || "latest_only";
  if (!("latest_only all skip".split(" ") as string[]).includes(missedPolicy)) throw new Error(options.missedPolicyError);

  return { frequency, interval, weekdays, monthDay, timezone, startDate, endDate, maxOccurrences, missedPolicy };
}

export function buildRecurrenceRule(input: NormalizedRecurrence) {
  const frequency = input.frequency === "daily" ? RRule.DAILY : input.frequency === "weekly" ? RRule.WEEKLY : RRule.MONTHLY;
  const options: Partial<Options> = { freq: frequency, interval: input.interval, dtstart: dateAtUtc(input.startDate) };
  if (input.endDate) options.until = dateAtUtc(input.endDate);
  if (input.frequency === "weekly") options.byweekday = input.weekdays.map((day) => weekdayMap[day]);
  if (input.frequency === "monthly") options.bymonthday = input.monthDay ?? Number(input.startDate.slice(8, 10));
  return new RRule(options).toString();
}

export function nextRecurrenceDate(ruleText: string, afterDate: string) {
  const next = rrulestr(ruleText).after(dateAtUtc(afterDate), false);
  return next ? dateKey(next) : null;
}

export function recurrenceDatesBetween(ruleText: string, startDate: string, endDate: string) {
  return rrulestr(ruleText).between(dateAtUtc(startDate), dateAtUtc(endDate), true).map(dateKey);
}
