import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays,
  addMonthsClamped,
  buildRecurrenceRule,
  daysBetween,
  nextRecurrenceDate,
  normalizeRecurrenceInput,
  recurrenceDatesBetween,
  todayInTimeZone,
} from "../db/todo-recurrence";

const personalOptions = {
  defaultFrequency: "daily" as const,
  maxOccurrencesError: "完成次数应为 1 至 10000。",
  missedPolicyError: "错过任务处理方式无效。",
};

const organizationOptions = {
  defaultFrequency: "weekly" as const,
  maxOccurrencesError: "执行次数应为 1 至 10000。",
  missedPolicyError: "错过周期处理方式无效。",
};

test("normalizes shared recurrence fields without changing personal defaults", () => {
  const value = normalizeRecurrenceInput({ startDate: "2026-09-01" }, undefined, personalOptions);
  assert.deepEqual(value, {
    frequency: "daily",
    interval: 1,
    weekdays: [2],
    monthDay: null,
    timezone: "Asia/Shanghai",
    startDate: "2026-09-01",
    endDate: null,
    maxOccurrences: null,
    missedPolicy: "latest_only",
  });
});

test("normalizes weekly and monthly recurrence fields", () => {
  const weekly = normalizeRecurrenceInput({
    frequency: "weekly",
    weekdays: [7, 1, 7, 0, 8],
    interval: 2.9,
    startDate: "2026-09-01",
  }, undefined, personalOptions);
  assert.deepEqual(weekly.weekdays, [1, 7]);
  assert.equal(weekly.interval, 2);

  const monthly = normalizeRecurrenceInput({
    frequency: "monthly",
    monthDay: -1,
    startDate: "2026-01-31",
    maxOccurrences: 12.9,
  }, undefined, personalOptions);
  assert.equal(monthly.monthDay, -1);
  assert.equal(monthly.maxOccurrences, 12);
});

test("keeps organization recurrence defaults and validation wording distinct", () => {
  const value = normalizeRecurrenceInput({ startDate: "2026-09-01" }, undefined, organizationOptions);
  assert.equal(value.frequency, "weekly");
  assert.deepEqual(value.weekdays, [2]);
  assert.throws(
    () => normalizeRecurrenceInput({ startDate: "2026-09-01", maxOccurrences: 0 }, undefined, organizationOptions),
    /执行次数应为 1 至 10000/,
  );
});

test("preserves fallback recurrence values during partial updates", () => {
  const fallback = {
    frequency: "weekly" as const,
    interval: 3,
    weekdays: [1, 5],
    monthDay: null,
    timezone: "Asia/Shanghai",
    startDate: "2026-09-01",
    endDate: "2026-12-31",
    maxOccurrences: 20,
    missedPolicy: "all" as const,
  };
  const value = normalizeRecurrenceInput({ interval: 4 }, fallback, personalOptions);
  assert.equal(value.frequency, "weekly");
  assert.equal(value.interval, 4);
  assert.deepEqual(value.weekdays, [1, 5]);
  assert.equal(value.endDate, "2026-12-31");
  assert.equal(value.maxOccurrences, 20);
  assert.equal(value.missedPolicy, "all");
});

test("rejects invalid shared recurrence input with the established messages", () => {
  assert.throws(() => normalizeRecurrenceInput({ timezone: "Mars/Base", startDate: "2026-09-01" }, undefined, personalOptions), /时区无效/);
  assert.throws(() => normalizeRecurrenceInput({ interval: 0, startDate: "2026-09-01" }, undefined, personalOptions), /重复间隔/);
  assert.throws(() => normalizeRecurrenceInput({ startDate: "2026-9-1" }, undefined, personalOptions), /开始日期无效/);
  assert.throws(() => normalizeRecurrenceInput({ startDate: "2026-09-02", endDate: "2026-09-01" }, undefined, personalOptions), /结束日期不能早于开始日期/);
  assert.throws(() => normalizeRecurrenceInput({ frequency: "weekly", weekdays: [], startDate: "2026-09-01" }, undefined, personalOptions), /至少选择一个星期/);
  assert.throws(() => normalizeRecurrenceInput({ frequency: "monthly", monthDay: 32, startDate: "2026-09-01" }, undefined, personalOptions), /每月日期/);
  assert.throws(() => normalizeRecurrenceInput({ maxOccurrences: 0, startDate: "2026-09-01" }, undefined, personalOptions), /完成次数/);
});

test("builds and evaluates daily, weekly, and month-end rules", () => {
  const daily = normalizeRecurrenceInput({ frequency: "daily", interval: 2, startDate: "2026-09-01" }, undefined, personalOptions);
  const dailyRule = buildRecurrenceRule(daily);
  assert.deepEqual(recurrenceDatesBetween(dailyRule, "2026-09-01", "2026-09-07"), ["2026-09-01", "2026-09-03", "2026-09-05", "2026-09-07"]);
  assert.equal(nextRecurrenceDate(dailyRule, "2026-09-07"), "2026-09-09");

  const weekly = normalizeRecurrenceInput({ frequency: "weekly", weekdays: [1, 5], startDate: "2026-09-01" }, undefined, personalOptions);
  assert.deepEqual(recurrenceDatesBetween(buildRecurrenceRule(weekly), "2026-09-01", "2026-09-14"), ["2026-09-04", "2026-09-07", "2026-09-11", "2026-09-14"]);

  const monthEnd = normalizeRecurrenceInput({ frequency: "monthly", monthDay: -1, startDate: "2026-01-01" }, undefined, personalOptions);
  assert.deepEqual(recurrenceDatesBetween(buildRecurrenceRule(monthEnd), "2026-01-01", "2026-03-31"), ["2026-01-31", "2026-02-28", "2026-03-31"]);
});

test("handles calendar arithmetic and timezone day keys", () => {
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addMonthsClamped("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsClamped("2024-01-31", 1), "2024-02-29");
  assert.equal(daysBetween("2026-09-03", "2026-09-01"), 2);
  assert.equal(daysBetween("2026-09-01", "2026-09-03"), 0);
  assert.equal(todayInTimeZone("Asia/Shanghai", new Date("2026-08-31T16:30:00.000Z")), "2026-09-01");
});
