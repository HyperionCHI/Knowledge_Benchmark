"use client";

import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { ActionIcon } from "../lib/workspace-icons";
import { OrganizationTodoDetailDialog } from "./OrganizationTodoDetailDialog";
import { OrganizationTodoAdmin } from "./OrganizationTodoAdmin";

type TodoItem = {
  id: string;
  recurrenceTemplateId: string | null;
  source: "temporary" | "recurring" | "organization";
  title: string;
  scheduledFor: string;
  status: "pending" | "completed" | "skipped";
  completedAt: string | null;
  overdueDays: number;
  organizationOccurrenceId?: string;
  description?: string;
  audienceType?: "all" | "custom";
  progress?: { completed: number; pending: number; total: number; percent: number };
};

type TodoTemplate = {
  id: string;
  title: string;
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  weekdays: number[];
  monthDay: number | null;
  recurrenceMode: "calendar" | "after_completion";
  timezone: string;
  startDate: string;
  endDate: string | null;
  maxOccurrences: number | null;
  generatedCount: number;
  missedPolicy: "latest_only" | "all" | "skip";
  waitForCompletion: boolean;
  paused: boolean;
  nextOccurrenceDate: string | null;
};

type Dashboard = {
  today: string;
  todayItems: TodoItem[];
  overdueItems: TodoItem[];
  historyItems: TodoItem[];
  temporaryItems: TodoItem[];
  templates: TodoTemplate[];
  organizationItems: TodoItem[];
};

type Tab = "recurring" | "temporary" | "organization" | "organization-admin" | "overdue" | "history";
type Position = { left: number; top: number };
type TemplateDraft = {
  id?: string;
  title: string;
  frequency: TodoTemplate["frequency"];
  interval: number;
  weekdays: number[];
  monthDay: number;
  recurrenceMode: TodoTemplate["recurrenceMode"];
  startDate: string;
  endDate: string;
  maxOccurrences: string;
  missedPolicy: TodoTemplate["missedPolicy"];
  waitForCompletion: boolean;
};

const preferenceKey = "knowledge-workbench-personal-todo-v1";
const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];

function readPreferences() {
  if (typeof window === "undefined") return { collapsed: false, position: { left: 18, top: 94 } };
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey) || "{}") as { collapsed?: boolean; position?: Position };
    return {
      collapsed: typeof saved.collapsed === "boolean" ? saved.collapsed : false,
      position: saved.position && Number.isFinite(saved.position.left) && Number.isFinite(saved.position.top) ? saved.position : { left: 18, top: 94 },
    };
  } catch { return { collapsed: false, position: { left: 18, top: 94 } }; }
}

function blankTemplate(today: string): TemplateDraft {
  return {
    title: "", frequency: "daily", interval: 1, weekdays: [1], monthDay: Number(today.slice(8, 10)),
    recurrenceMode: "calendar", startDate: today, endDate: "", maxOccurrences: "",
    missedPolicy: "latest_only", waitForCompletion: false,
  };
}

function templateToDraft(item: TodoTemplate): TemplateDraft {
  return {
    id: item.id, title: item.title, frequency: item.frequency, interval: item.interval,
    weekdays: item.weekdays, monthDay: item.monthDay || 1, recurrenceMode: item.recurrenceMode,
    startDate: item.startDate, endDate: item.endDate || "",
    maxOccurrences: item.maxOccurrences == null ? "" : String(item.maxOccurrences),
    missedPolicy: item.missedPolicy, waitForCompletion: item.waitForCompletion,
  };
}

async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "操作失败。");
  return body;
}

export function PersonalTodo({
  showWidget,
  settingsOpen,
  isAdmin,
  onCloseSettings,
  toast,
}: {
  showWidget: boolean;
  settingsOpen: boolean;
  isAdmin: boolean;
  onCloseSettings: () => void;
  toast: (message: string) => void;
}) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState<Position>({ left: 18, top: 94 });
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState<Tab>("recurring");
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft | null>(null);
  const [editingTemp, setEditingTemp] = useState<TodoItem | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const preferencesLoaded = useRef(false);

  async function load() {
    try { setDashboard(await api<Dashboard>("/api/todos")); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "待办读取失败。"); }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = readPreferences();
      setCollapsed(saved.collapsed);
      setPosition(saved.position);
      preferencesLoaded.current = true;
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [settingsOpen]);

  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener("organization-todo-updated", refresh);
    const interval = showWidget || settingsOpen ? window.setInterval(refresh, 30_000) : null;
    return () => {
      window.removeEventListener("organization-todo-updated", refresh);
      if (interval) window.clearInterval(interval);
    };
  }, [showWidget, settingsOpen]);

  useEffect(() => {
    if (!preferencesLoaded.current) return;
    localStorage.setItem(preferenceKey, JSON.stringify({ collapsed, position }));
  }, [collapsed, position]);

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const width = collapsed ? 48 : 260;
      setPosition({
        left: Math.max(8, Math.min(window.innerWidth - width - 8, event.clientX - dragOffset.current.x)),
        top: Math.max(64, Math.min(window.innerHeight - 56, event.clientY - dragOffset.current.y)),
      });
    };
    const stop = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
  }, [dragging, collapsed]);

  function beginDrag(event: ReactPointerEvent<HTMLElement>) {
    dragOffset.current = { x: event.clientX - position.left, y: event.clientY - position.top };
    setDragging(true);
  }

  async function mutate(action: () => Promise<unknown>, message: string) {
    setBusy(true); setError("");
    try { await action(); await load(); toast(message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败。"); }
    finally { setBusy(false); }
  }

  async function addQuick(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;
    await mutate(() => api("/api/todos/items", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }),
    }), "已添加今日待办");
    setQuickTitle("");
  }

  function setItemState(item: TodoItem, checked: boolean) {
    return mutate(() => api(`/api/todos/items/${item.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: checked ? "complete" : "reopen" }),
    }), checked ? "待办已完成" : "待办已恢复");
  }

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!templateDraft) return;
    const payload = {
      ...templateDraft,
      endDate: templateDraft.endDate || null,
      maxOccurrences: templateDraft.maxOccurrences ? Number(templateDraft.maxOccurrences) : null,
    };
    await mutate(() => api(templateDraft.id ? `/api/todos/templates/${templateDraft.id}` : "/api/todos/templates", {
      method: templateDraft.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }), templateDraft.id ? "周期任务已更新" : "周期任务已创建");
    setTemplateDraft(null);
  }

  async function saveTemporary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingTemp) return;
    await mutate(() => api(`/api/todos/items/${editingTemp.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editingTemp.title, scheduledFor: editingTemp.scheduledFor }),
    }), "临时待办已更新");
    setEditingTemp(null);
  }

  const recurrenceLabel = (item: TodoTemplate) => {
    const unit = item.frequency === "daily" ? "天" : item.frequency === "weekly" ? "周" : "月";
    const detail = item.frequency === "weekly" ? ` · 周${item.weekdays.map((day) => weekdayLabels[day - 1]).join("、")}`
      : item.frequency === "monthly" ? ` · ${item.monthDay === -1 ? "月末" : `${item.monthDay} 日`}` : "";
    return `每 ${item.interval} ${unit}${detail} · ${item.recurrenceMode === "calendar" ? "固定周期" : "完成后周期"}`;
  };

  return <>
    {showWidget && (collapsed ? (
      <button
        className="personal-todo-collapsed"
        style={position}
        aria-label="展开今日待办"
        title="展开今日待办"
        onClick={() => setCollapsed(false)}
      ><ActionIcon name="check" size={20} />{dashboard?.todayItems.some((item) => item.status === "pending") && <i />}</button>
    ) : (
      <aside className={`personal-todo-widget${dragging ? " dragging" : ""}`} style={position} aria-label="今日待办">
        <header>
          <button type="button" className="personal-todo-drag-handle" aria-label="拖动今日待办" onPointerDown={beginDrag}><ActionIcon name="drag" size={14} /></button>
          <div><b>今日待办</b><small>{dashboard ? `${dashboard.todayItems.filter((item) => item.status === "pending").length} 项未完成` : "正在读取…"}</small></div>
          <button type="button" title="收起" aria-label="收起今日待办" onClick={() => setCollapsed(true)}><ActionIcon name="collapsePanel" size={16} /></button>
        </header>
        <div className="personal-todo-quick-list">
          {dashboard?.todayItems.map((item) => <div key={item.id} className={`personal-todo-quick-item ${item.status === "completed" ? "completed" : ""} ${item.overdueDays ? "overdue" : ""}`}>
            <input aria-label={`${item.status === "completed" ? "恢复" : "完成"}待办：${item.title}`} type="checkbox" checked={item.status === "completed"} disabled={busy} onChange={(event) => { void setItemState(item, event.target.checked); }} />
            <span>{item.source === "organization" && <em className={`organization-todo-badge ${item.audienceType}`}>{item.audienceType === "custom" ? "指定范围" : "全员"}</em>}<b>{item.title}</b>{item.source === "organization" && item.progress && <small className="organization-todo-item-progress">{item.progress.completed}/{item.progress.total} 人已完成</small>}{item.overdueDays > 0 && <small>逾期 {item.overdueDays} 天</small>}{item.organizationOccurrenceId && <button type="button" onClick={() => setDetailId(item.organizationOccurrenceId!)}>查看详情</button>}</span>
          </div>)}
          {dashboard && !dashboard.todayItems.length && <p>今天还没有待办。</p>}
          {!dashboard && !error && <p>正在读取待办…</p>}
        </div>
        <form className="personal-todo-quick-add" onSubmit={addQuick}>
          <input aria-label="添加今日待办" value={quickTitle} maxLength={160} onChange={(event) => setQuickTitle(event.target.value)} placeholder="添加今日待办" />
          <button type="submit" disabled={busy || !quickTitle.trim()} aria-label="添加"><ActionIcon name="add" size={16} /></button>
        </form>
        {error && <p className="personal-todo-error">{error}</p>}
      </aside>
    ))}

    {settingsOpen && <div className="modal-backdrop personal-todo-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCloseSettings(); }}>
      <section className="modal personal-todo-settings" role="dialog" aria-modal="true" aria-labelledby="personal-todo-settings-title">
        <header>
          <div><span>PERSONAL TODO</span><h2 id="personal-todo-settings-title">TODO 设置</h2><p>管理个人待办、组织待办与完成记录。</p></div>
          <button onClick={onCloseSettings} aria-label="关闭"><ActionIcon name="close" /></button>
        </header>
        <nav className="personal-todo-tabs" aria-label="Todo 设置栏目">
          <button className={tab === "recurring" ? "active" : ""} onClick={() => setTab("recurring")}>周期任务 <small>{dashboard?.templates.length || 0}</small></button>
          <button className={tab === "temporary" ? "active" : ""} onClick={() => setTab("temporary")}>临时待办 <small>{dashboard?.temporaryItems.length || 0}</small></button>
          <button className={tab === "organization" ? "active" : ""} onClick={() => setTab("organization")}>组织待办 <small>{dashboard?.organizationItems.length || 0}</small></button>
          {isAdmin && <button className={tab === "organization-admin" ? "active" : ""} onClick={() => setTab("organization-admin")}>组织TODO管理</button>}
          <button className={tab === "overdue" ? "active" : ""} onClick={() => setTab("overdue")}>过期待办 <small>{dashboard?.overdueItems.length || 0}</small></button>
          <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>历史记录 <small>{dashboard?.historyItems.length || 0}</small></button>
        </nav>
        {error && <p className="form-error">{error}</p>}

        {tab === "recurring" && <div className="personal-todo-panel">
          <div className="personal-todo-panel-head"><div><b>任务设置</b><small>每个周期由模板生成独立待办实例，仅预生成近期一项。</small></div><button className="primary" onClick={() => setTemplateDraft(blankTemplate(dashboard?.today || new Date().toISOString().slice(0, 10)))}><ActionIcon name="add" />新建周期任务</button></div>
          <div className="personal-todo-manage-list">
            {dashboard?.templates.map((item) => <article key={item.id} className={item.paused ? "paused" : ""}>
              <div><b>{item.title}</b><small>{recurrenceLabel(item)}</small><small>{item.paused ? "已暂停" : `下一期：${item.nextOccurrenceDate || "完成后生成"}`}</small></div>
              <div>
                <button onClick={() => setTemplateDraft(templateToDraft(item))}><ActionIcon name="edit" size={14} />编辑</button>
                <button onClick={() => { void mutate(() => api(`/api/todos/templates/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused: !item.paused }) }), item.paused ? "周期任务已启用" : "周期任务已暂停"); }}>{item.paused ? "启用" : "暂停"}</button>
                <button className="danger-action" onClick={() => { if (window.confirm("删除该周期任务？已完成的历史记录会保留。")) void mutate(() => api(`/api/todos/templates/${item.id}`, { method: "DELETE" }), "周期任务已删除"); }}><ActionIcon name="delete" size={14} />删除</button>
              </div>
            </article>)}
            {dashboard && !dashboard.templates.length && <p className="personal-todo-empty">尚未创建周期任务。</p>}
          </div>
        </div>}

        {tab === "temporary" && <div className="personal-todo-panel">
          <div className="personal-todo-panel-head"><div><b>临时待办</b><small>主页快速添加会创建今日截止、不会重复的临时待办。</small></div></div>
          <div className="personal-todo-manage-list">
            {dashboard?.temporaryItems.map((item) => <article key={item.id}>
              <div><b className={item.overdueDays ? "overdue-text" : ""}>{item.title}</b><small>截止：{item.scheduledFor}{item.overdueDays ? ` · 逾期 ${item.overdueDays} 天` : ""} · {item.status === "completed" ? "已完成" : "未完成"}</small></div>
              <div><button onClick={() => setEditingTemp(item)}><ActionIcon name="edit" size={14} />编辑</button><button className="danger-action" onClick={() => { if (window.confirm("删除这条临时待办？")) void mutate(() => api(`/api/todos/items/${item.id}`, { method: "DELETE" }), "临时待办已删除"); }}><ActionIcon name="delete" size={14} />删除</button></div>
            </article>)}
            {dashboard && !dashboard.temporaryItems.length && <p className="personal-todo-empty">暂无临时待办。</p>}
          </div>
        </div>}

        {tab === "organization" && <div className="personal-todo-panel">
          <div className="personal-todo-panel-head"><div><b>组织待办</b><small>由管理员创建；你只能更新自己的完成状态。</small></div></div>
          <OrganizationTodoList items={dashboard?.organizationItems || []} busy={busy} onToggle={setItemState} onDetail={setDetailId} />
        </div>}

        {tab === "organization-admin" && isAdmin && <OrganizationTodoAdmin toast={toast} />}

        {tab === "overdue" && <TodoItemList items={dashboard?.overdueItems || []} empty="没有过期待办。" busy={busy} onToggle={setItemState} onDetail={setDetailId} />}
        {tab === "history" && <TodoItemList items={dashboard?.historyItems || []} empty="暂无完成记录。" busy={busy} onToggle={setItemState} onDetail={setDetailId} history />}
      </section>
    </div>}

    {templateDraft && <div className="modal-backdrop personal-todo-editor-backdrop">
      <form className="modal personal-todo-editor" onSubmit={saveTemplate}>
        <header><div><span>RECURRENCE TEMPLATE</span><h2>{templateDraft.id ? "编辑周期任务" : "新建周期任务"}</h2></div><button type="button" onClick={() => setTemplateDraft(null)} aria-label="关闭"><ActionIcon name="close" /></button></header>
        <label className="form-wide">任务名称<input required maxLength={160} value={templateDraft.title} onChange={(event) => setTemplateDraft({ ...templateDraft, title: event.target.value })} /></label>
        <div className="personal-todo-form-grid">
          <label>周期<select value={templateDraft.frequency} onChange={(event) => setTemplateDraft({ ...templateDraft, frequency: event.target.value as TodoTemplate["frequency"] })}><option value="daily">每日</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label>
          <label>每隔几期重复<input type="number" min={1} max={99} value={templateDraft.interval} onChange={(event) => setTemplateDraft({ ...templateDraft, interval: Number(event.target.value) })} /><small>例如选择“每周”并填 2，表示每 2 周一次。</small></label>
          <label>下一期从何时开始计算<select value={templateDraft.recurrenceMode} onChange={(event) => setTemplateDraft({ ...templateDraft, recurrenceMode: event.target.value as TodoTemplate["recurrenceMode"], waitForCompletion: event.target.value === "after_completion" })}><option value="calendar">按固定日期重复</option><option value="after_completion">从本期完成当天开始计算</option></select><small>固定日期适合例会；完成后计算适合必须做完再进入下一期的任务。</small></label>
          <label>错过日期后怎么处理<select value={templateDraft.missedPolicy} onChange={(event) => setTemplateDraft({ ...templateDraft, missedPolicy: event.target.value as TodoTemplate["missedPolicy"] })}><option value="latest_only">只补最近一次</option><option value="all">补上所有漏掉的任务（最多 500 项）</option><option value="skip">不补已经过期的任务</option></select><small>决定多天未打开工作台时，系统需要补回哪些待办。</small></label>
          <label>开始日期<input required type="date" value={templateDraft.startDate} onChange={(event) => setTemplateDraft({ ...templateDraft, startDate: event.target.value })} /></label>
          <label>结束日期（可选）<input type="date" value={templateDraft.endDate} onChange={(event) => setTemplateDraft({ ...templateDraft, endDate: event.target.value })} /></label>
          <label>最多生成多少期（选填）<input type="number" min={1} max={10000} value={templateDraft.maxOccurrences} onChange={(event) => setTemplateDraft({ ...templateDraft, maxOccurrences: event.target.value })} /><small>留空表示一直重复；填 10 表示最多生成 10 期。</small></label>
          {templateDraft.frequency === "monthly" && <label>每月日期<input type="number" min={-1} max={31} value={templateDraft.monthDay} onChange={(event) => setTemplateDraft({ ...templateDraft, monthDay: Number(event.target.value) })} /><small>-1 表示月末</small></label>}
        </div>
        {templateDraft.frequency === "weekly" && <fieldset className="personal-todo-weekdays"><legend>每周在星期几生成</legend>{weekdayLabels.map((label, index) => { const inputId = `personal-todo-weekday-${index + 1}`; return <div className="personal-todo-weekday-option" key={label}><input id={inputId} type="checkbox" checked={templateDraft.weekdays.includes(index + 1)} onChange={(event) => setTemplateDraft({ ...templateDraft, weekdays: event.target.checked ? [...templateDraft.weekdays, index + 1].sort() : templateDraft.weekdays.filter((day) => day !== index + 1) })} /><label htmlFor={inputId}>周{label}</label></div>; })}</fieldset>}
        {templateDraft.recurrenceMode === "calendar" && <div className="personal-todo-check"><input id="personal-todo-wait-for-completion" type="checkbox" checked={templateDraft.waitForCompletion} onChange={(event) => setTemplateDraft({ ...templateDraft, waitForCompletion: event.target.checked })} /><label htmlFor="personal-todo-wait-for-completion"><b>等我完成上一期，再显示下一期</b><small>开启后，同一个周期任务只会保留一期未完成待办。</small></label></div>}
        <footer><button type="button" className="secondary" onClick={() => setTemplateDraft(null)}>取消</button><button className="primary" disabled={busy}>{busy ? "保存中…" : "保存"}</button></footer>
      </form>
    </div>}

    {editingTemp && <div className="modal-backdrop personal-todo-editor-backdrop">
      <form className="modal personal-todo-editor personal-todo-temp-editor" onSubmit={saveTemporary}>
        <header><div><span>TEMPORARY TODO</span><h2>编辑临时待办</h2></div><button type="button" onClick={() => setEditingTemp(null)} aria-label="关闭"><ActionIcon name="close" /></button></header>
        <label>任务名称<input required maxLength={160} value={editingTemp.title} onChange={(event) => setEditingTemp({ ...editingTemp, title: event.target.value })} /></label>
        <label>截止日期<input required type="date" value={editingTemp.scheduledFor} onChange={(event) => setEditingTemp({ ...editingTemp, scheduledFor: event.target.value })} /></label>
        <footer><button type="button" className="secondary" onClick={() => setEditingTemp(null)}>取消</button><button className="primary" disabled={busy}>保存</button></footer>
      </form>
    </div>}
    {detailId && <OrganizationTodoDetailDialog occurrenceId={detailId} onClose={() => setDetailId(null)} />}
  </>;
}

function TodoItemList({ items, empty, busy, onToggle, onDetail, history = false }: {
  items: TodoItem[];
  empty: string;
  busy: boolean;
  onToggle: (item: TodoItem, checked: boolean) => Promise<void>;
  onDetail: (id: string) => void;
  history?: boolean;
}) {
  return <div className="personal-todo-manage-list personal-todo-record-list">
    {items.map((item) => <div key={item.id} className={item.overdueDays ? "overdue" : ""}>
      <input aria-label={history ? `恢复待办：${item.title}` : `完成待办：${item.title}`} type="checkbox" checked={history || item.status === "completed"} disabled={busy} onChange={(event) => { void onToggle(item, event.target.checked); }} />
      <span><b>{item.source === "organization" && <em className={`organization-todo-badge ${item.audienceType}`}>{item.audienceType === "custom" ? "指定范围" : "全员"}</em>}{item.title}</b><small>{history ? `原截止：${item.scheduledFor} · 取消勾选可恢复` : `截止：${item.scheduledFor} · 逾期 ${item.overdueDays} 天`}</small>{item.organizationOccurrenceId && <button type="button" onClick={() => onDetail(item.organizationOccurrenceId!)}>查看详情</button>}</span>
    </div>)}
    {!items.length && <p className="personal-todo-empty">{empty}</p>}
  </div>;
}

function OrganizationTodoList({ items, busy, onToggle, onDetail }: { items: TodoItem[]; busy: boolean; onToggle: (item: TodoItem, checked: boolean) => Promise<void>; onDetail: (id: string) => void }) {
  return <div className="personal-todo-manage-list organization-todo-personal-list">
    {items.map((item) => <article className={item.overdueDays ? "overdue" : ""} key={item.id}><input type="checkbox" checked={item.status === "completed"} disabled={busy} onChange={(event) => { void onToggle(item, event.target.checked); }} /><div><b><em className={`organization-todo-badge ${item.audienceType}`}>{item.audienceType === "custom" ? "指定范围" : "全员"}</em>{item.title}</b><small>{item.scheduledFor} · {item.status === "completed" ? "已完成" : item.overdueDays ? `逾期 ${item.overdueDays} 天` : "未完成"}{item.progress ? ` · ${item.progress.completed}/${item.progress.total} 人已完成` : ""}</small></div><button type="button" onClick={() => onDetail(item.organizationOccurrenceId!)}>查看详情</button></article>)}
    {!items.length && <p className="personal-todo-empty">当前没有组织待办。</p>}
  </div>;
}
