"use client";

import { useEffect, useState } from "react";
import { ActionIcon } from "../lib/workspace-icons";

type Person = { id: string; name: string; username: string; completedAt: string | null; isCurrentUser: boolean };
type Detail = {
  id: string; title: string; description: string; audienceType: "all" | "custom"; scheduledFor: string;
  progress: { completed: number; pending: number; total: number; percent: number };
  completed: Person[]; pending: Person[]; exempt: Person[]; canManage: boolean;
};

export function OrganizationTodoDetailDialog({ occurrenceId, onClose }: { occurrenceId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<"completed" | "pending" | "exempt">("completed");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/organization-todos/occurrences/${occurrenceId}`).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "任务详情读取失败。");
      if (active) setDetail(body.detail);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "任务详情读取失败。"); });
    return () => { active = false; };
  }, [occurrenceId]);

  const source = detail ? detail[tab] : [];
  const normalized = query.trim().toLocaleLowerCase();
  const people = source.filter((person) => !normalized || `${person.name} ${person.username}`.toLocaleLowerCase().includes(normalized));

  return <div className="modal-backdrop organization-todo-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal organization-todo-detail" role="dialog" aria-modal="true" aria-labelledby="organization-todo-detail-title">
      <header><div><span>{detail?.audienceType === "custom" ? "SELECTED RECIPIENTS" : "ALL MEMBERS"}</span><h2 id="organization-todo-detail-title">{detail?.title || "组织待办详情"}</h2><p>{detail ? `${detail.scheduledFor} · ${detail.audienceType === "custom" ? "指定范围" : "全员"}` : "正在读取…"}</p></div><button onClick={onClose} aria-label="关闭"><ActionIcon name="close" /></button></header>
      {error ? <p className="form-error">{error}</p> : !detail ? <p className="personal-todo-empty">正在读取完成情况…</p> : <>
        {detail.description && <p className="organization-todo-description">{detail.description}</p>}
        <div className="organization-todo-progress"><div><b>{detail.progress.completed} / {detail.progress.total}</b><span>已完成 · {detail.progress.percent}%</span></div><i><span style={{ width: `${detail.progress.percent}%` }} /></i></div>
        <nav className="personal-todo-tabs">
          <button className={tab === "completed" ? "active" : ""} onClick={() => setTab("completed")}>已完成 <small>{detail.completed.length}</small></button>
          <button className={tab === "pending" ? "active" : ""} onClick={() => setTab("pending")}>未完成 <small>{detail.pending.length}</small></button>
          {detail.canManage && <button className={tab === "exempt" ? "active" : ""} onClick={() => setTab("exempt")}>不计入 <small>{detail.exempt.length}</small></button>}
        </nav>
        <label className="organization-todo-people-search"><ActionIcon name="search" size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名或账号" /></label>
        <div className="organization-todo-people">
          {people.map((person) => <article className={person.isCurrentUser ? "current" : ""} key={person.id}><i>{person.name.slice(0, 1)}</i><div><b>{person.name}{person.isCurrentUser && <em>我</em>}</b><small>{person.username || "—"}{tab === "completed" && person.completedAt ? ` · ${new Date(person.completedAt).toLocaleString("zh-CN")}` : ""}</small></div></article>)}
          {!people.length && <p className="personal-todo-empty">没有符合条件的人员。</p>}
        </div>
      </>}
    </section>
  </div>;
}
