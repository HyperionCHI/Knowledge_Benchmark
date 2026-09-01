"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ActionIcon } from "../lib/workspace-icons";
import { OrganizationTodoDetailDialog } from "./OrganizationTodoDetailDialog";

type AdminUser = { id: string; name: string; username: string; role: "admin" | "editor" | "viewer" };
type Progress = { completed: number; pending: number; total: number; percent: number };
type Template = {
  id: string; title: string; description: string; audienceType: "all" | "custom"; recipientIds: string[];
  frequency: "daily" | "weekly" | "monthly"; interval: number; weekdays: number[]; monthDay: number | null;
  startDate: string; endDate: string | null; maxOccurrences: number | null; generatedCount: number;
  missedPolicy: "latest_only" | "all" | "skip"; paused: boolean; nextOccurrenceDate: string | null; recipientCount: number;
  currentOccurrence: { id: string; scheduledFor: string; progress: Progress } | null;
};
type Dashboard = { users: AdminUser[]; templates: Template[] };
type Draft = {
  id?: string; title: string; description: string; audienceType: "all" | "custom"; recipientIds: string[];
  frequency: Template["frequency"]; interval: number; weekdays: number[]; monthDay: number;
  startDate: string; endDate: string; maxOccurrences: string; missedPolicy: Template["missedPolicy"]; applyToCurrent: boolean;
};

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const roleLabels = { admin: "管理员", editor: "编辑人员", viewer: "普通用户" };

function today() { return new Date().toISOString().slice(0, 10); }
function blankDraft(): Draft { return { title: "", description: "", audienceType: "all", recipientIds: [], frequency: "weekly", interval: 1, weekdays: [1], monthDay: Number(today().slice(8)), startDate: today(), endDate: "", maxOccurrences: "", missedPolicy: "latest_only", applyToCurrent: false }; }
function editDraft(item: Template): Draft { return { id: item.id, title: item.title, description: item.description, audienceType: item.audienceType, recipientIds: item.recipientIds, frequency: item.frequency, interval: item.interval, weekdays: item.weekdays, monthDay: item.monthDay || 1, startDate: item.startDate, endDate: item.endDate || "", maxOccurrences: item.maxOccurrences == null ? "" : String(item.maxOccurrences), missedPolicy: item.missedPolicy, applyToCurrent: false }; }

export function OrganizationTodoAdmin({ toast }: { toast: (message: string) => void }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | AdminUser["role"]>("all");

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/admin/organization-todos");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "组织周期 Todo 读取失败。");
      setDashboard(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "组织周期 Todo 读取失败。"); }
  }

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, []);

  async function mutate(url: string, init: RequestInit, message: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(url, init); const body = await response.json();
      if (!response.ok) throw new Error(body.error || "操作失败。");
      await load(); window.dispatchEvent(new CustomEvent("organization-todo-updated")); toast(message); return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败。"); return false; }
    finally { setBusy(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!draft) return;
    if (draft.audienceType === "custom" && !draft.recipientIds.length) return setError("请至少选择一名接收人。");
    const payload = { ...draft, endDate: draft.endDate || null, maxOccurrences: draft.maxOccurrences ? Number(draft.maxOccurrences) : null };
    const saved = await mutate(draft.id ? `/api/admin/organization-todos/${draft.id}` : "/api/admin/organization-todos", {
      method: draft.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }, draft.id ? "组织周期 Todo 已更新" : "组织周期 Todo 已创建");
    if (saved) setDraft(null);
  }

  const matchingUsers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return (dashboard?.users || []).filter((user) => (role === "all" || user.role === role) && (!normalized || `${user.name} ${user.username}`.toLocaleLowerCase().includes(normalized)));
  }, [dashboard?.users, query, role]);

  const cycleLabel = (item: Template) => {
    const unit = item.frequency === "daily" ? "天" : item.frequency === "weekly" ? "周" : "月";
    const detail = item.frequency === "weekly" ? ` · 周${item.weekdays.map((day) => weekdays[day - 1]).join("、")}` : item.frequency === "monthly" ? ` · ${item.monthDay === -1 ? "月末" : `${item.monthDay} 日`}` : "";
    return `每 ${item.interval} ${unit}${detail}`;
  };

  return <section className="organization-todo-admin">
    <div className="organization-todo-admin-head"><div><h3>组织TODO管理</h3><p>创建全员或指定范围任务，查看每一期的完成情况。</p></div><button className="primary" onClick={() => setDraft(blankDraft())}><ActionIcon name="add" />新建组织 Todo</button></div>
    {error && <p className="form-error">{error}</p>}
    <div className="organization-todo-template-list">
      {dashboard?.templates.map((item) => <article className={item.paused ? "paused" : ""} key={item.id}>
        <div className="organization-todo-template-main"><span className={item.audienceType}>{item.audienceType === "all" ? "全员" : "指定范围"}</span><div><b>{item.title}</b><small>{cycleLabel(item)} · {item.recipientCount} 人 · {item.paused ? "已暂停" : `下一期 ${item.nextOccurrenceDate || "已结束"}`}</small></div></div>
        <div className="organization-todo-template-progress">{item.currentOccurrence ? <><b>{item.currentOccurrence.progress.completed}/{item.currentOccurrence.progress.total}</b><small>本期已完成 · {item.currentOccurrence.scheduledFor}</small></> : <><b>—</b><small>尚未生成本期</small></>}</div>
        <div className="organization-todo-template-actions">
          {item.currentOccurrence && <button onClick={() => setDetailId(item.currentOccurrence!.id)}>查看详情</button>}
          <button onClick={() => setDraft(editDraft(item))}><ActionIcon name="edit" size={14} />编辑</button>
          <button disabled={busy} onClick={() => { void mutate(`/api/admin/organization-todos/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused: !item.paused }) }, item.paused ? "组织周期 Todo 已恢复" : "组织周期 Todo 已暂停"); }}>{item.paused ? "恢复" : "暂停"}</button>
          <button className="danger-action" disabled={busy} onClick={() => { if (window.confirm(`归档“${item.title}”？历史完成记录会保留，但不再生成新一期。`)) void mutate(`/api/admin/organization-todos/${item.id}`, { method: "DELETE" }, "组织周期 Todo 已归档"); }}>归档</button>
        </div>
      </article>)}
      {dashboard && !dashboard.templates.length && <p className="personal-todo-empty">尚未创建组织周期 Todo。</p>}
      {!dashboard && !error && <p className="personal-todo-empty">正在读取组织周期 Todo…</p>}
    </div>

    {draft && <div className="modal-backdrop organization-todo-editor-backdrop">
      <form className="modal organization-todo-editor" onSubmit={save}>
        <header><div><span>ORGANIZATION TODO</span><h2>{draft.id ? "编辑组织周期 Todo" : "新建组织周期 Todo"}</h2><p>固定日历周期；每一期独立统计完成情况。</p></div><button type="button" onClick={() => setDraft(null)} aria-label="关闭"><ActionIcon name="close" /></button></header>
        <div className="organization-todo-editor-scroll">
          <label className="form-wide">任务名称<input required maxLength={160} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label className="form-wide">任务说明（选填）<textarea maxLength={2000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="说明完成要求或注意事项" /></label>
          <fieldset className="organization-todo-audience"><legend>接收范围</legend><label><input type="radio" checked={draft.audienceType === "all"} onChange={() => setDraft({ ...draft, audienceType: "all" })} />全员 <small>{dashboard?.users.length || 0} 个有效账号</small></label><label><input type="radio" checked={draft.audienceType === "custom"} onChange={() => setDraft({ ...draft, audienceType: "custom" })} />指定人员 <small>已选 {draft.recipientIds.length} 人</small></label></fieldset>
          {draft.audienceType === "custom" && <div className="organization-todo-picker">
            <div><label><ActionIcon name="search" size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名或账号" /></label><select value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="all">全部角色</option><option value="admin">管理员</option><option value="editor">编辑人员</option><option value="viewer">普通用户</option></select><button type="button" onClick={() => setDraft({ ...draft, recipientIds: [...new Set([...draft.recipientIds, ...matchingUsers.map((user) => user.id)])] })}>全选当前结果</button><button type="button" onClick={() => setDraft({ ...draft, recipientIds: [] })}>清空</button></div>
            <div className="organization-todo-picker-list">{matchingUsers.map((user) => <label key={user.id}><input type="checkbox" checked={draft.recipientIds.includes(user.id)} onChange={(event) => setDraft({ ...draft, recipientIds: event.target.checked ? [...draft.recipientIds, user.id] : draft.recipientIds.filter((id) => id !== user.id) })} /><i>{user.name.slice(0, 1)}</i><span><b>{user.name}</b><small>{user.username} · {roleLabels[user.role]}</small></span></label>)}</div>
          </div>}
          <div className="personal-todo-form-grid">
            <label>周期<select value={draft.frequency} onChange={(event) => setDraft({ ...draft, frequency: event.target.value as Draft["frequency"] })}><option value="daily">每日</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label>
            <label>每隔几期重复<input type="number" min={1} max={99} value={draft.interval} onChange={(event) => setDraft({ ...draft, interval: Number(event.target.value) })} /><small>例如选择“每周”并填 2，表示每 2 周一次。</small></label>
            <label>开始日期<input required type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></label>
            <label>结束日期（选填）<input type="date" value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} /></label>
            <label>最多生成多少期（选填）<input type="number" min={1} max={10000} value={draft.maxOccurrences} onChange={(event) => setDraft({ ...draft, maxOccurrences: event.target.value })} /><small>留空表示一直重复；填 10 表示最多生成 10 期。</small></label>
            <label>错过日期后怎么处理<select value={draft.missedPolicy} onChange={(event) => setDraft({ ...draft, missedPolicy: event.target.value as Draft["missedPolicy"] })}><option value="latest_only">只补最近一次</option><option value="all">补上所有漏掉的任务（最多 500 项）</option><option value="skip">不补已经过期的任务</option></select><small>决定多天未打开工作台时，系统需要补回哪些待办。</small></label>
            {draft.frequency === "monthly" && <label>每月日期<input type="number" min={-1} max={31} value={draft.monthDay} onChange={(event) => setDraft({ ...draft, monthDay: Number(event.target.value) })} /><small>-1 表示月末</small></label>}
          </div>
          {draft.frequency === "weekly" && <fieldset className="personal-todo-weekdays"><legend>每周在星期几生成</legend>{weekdays.map((label, index) => { const inputId = `organization-todo-weekday-${index + 1}`; return <div className="personal-todo-weekday-option" key={label}><input id={inputId} type="checkbox" checked={draft.weekdays.includes(index + 1)} onChange={(event) => setDraft({ ...draft, weekdays: event.target.checked ? [...draft.weekdays, index + 1].sort() : draft.weekdays.filter((day) => day !== index + 1) })} /><label htmlFor={inputId}>周{label}</label></div>; })}</fieldset>}
          {draft.id && <div className="personal-todo-check"><input id="organization-todo-apply-current" type="checkbox" checked={draft.applyToCurrent} onChange={(event) => setDraft({ ...draft, applyToCurrent: event.target.checked })} /><label htmlFor="organization-todo-apply-current"><b>同时调整正在进行的这一期</b><small>新增人员会立即收到本期任务，移除人员将不再计入本期统计。</small></label></div>}
        </div>
        <footer><span>{draft.audienceType === "all" ? `将发送给 ${dashboard?.users.length || 0} 人` : `已选择 ${draft.recipientIds.length} 人`}</span><button type="button" onClick={() => setDraft(null)}>取消</button><button className="primary" disabled={busy}>{busy ? "保存中…" : "保存"}</button></footer>
      </form>
    </div>}
    {detailId && <OrganizationTodoDetailDialog occurrenceId={detailId} onClose={() => setDetailId(null)} />}
  </section>;
}
