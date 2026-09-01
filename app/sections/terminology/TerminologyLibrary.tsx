"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { SectionFrame } from "../../components/SectionFrame";
import { ActionIcon } from "../../lib/workspace-icons";
import type { CategoryRecord, TermRecord } from "./types";

const PAGE_SIZE = 24;
const defaultCategoryDraft = { name: "", description: "", color: "#124f9f" };

export function TerminologyLibrary({ canEdit = false }: { canEdit?: boolean }) {
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [terms, setTerms] = useState<TermRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [activeCategory, setActiveCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [termDialogOpen, setTermDialogOpen] = useState(false);
  const [editingTerm, setEditingTerm] = useState<TermRecord | null>(null);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState(defaultCategoryDraft);
  const [saving, setSaving] = useState(false);
  const termDialogRef = useRef<HTMLDialogElement>(null);
  const categoryDialogRef = useRef<HTMLDialogElement>(null);

  const categoryMap = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/term-categories", { signal: controller.signal })
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "分类读取失败");
        setCategories(data.categories ?? []);
      })
      .catch((error) => { if (error.name !== "AbortError") setNotice(error.message); });
    return () => controller.abort();
  }, [reloadToken]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ limit: String(limit) });
      if (query.trim()) params.set("query", query.trim());
      if (activeCategory !== "all") params.set("category", activeCategory);
      fetch(`/api/terms?${params}`, { signal: controller.signal })
        .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
          if (!ok) throw new Error(data.error || "术语读取失败");
          setTerms(data.terms ?? []);
          setTotal(Number(data.total ?? 0));
        })
        .catch((error) => { if (error.name !== "AbortError") setNotice(error.message); })
        .finally(() => setLoading(false));
    }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [activeCategory, limit, query, reloadToken]);

  useEffect(() => { if (termDialogOpen) termDialogRef.current?.showModal(); else termDialogRef.current?.close(); }, [termDialogOpen]);
  useEffect(() => { if (categoryDialogOpen) categoryDialogRef.current?.showModal(); else categoryDialogRef.current?.close(); }, [categoryDialogOpen]);

  function refresh(message?: string) {
    setReloadToken((value) => value + 1);
    if (message) setNotice(message);
  }

  function chooseCategory(categoryId: string) {
    setActiveCategory(categoryId);
    setLimit(PAGE_SIZE);
  }

  function openCreateTerm() {
    setEditingTerm(null);
    setTermDialogOpen(true);
  }

  function openEditTerm(term: TermRecord) {
    setEditingTerm(term);
    setTermDialogOpen(true);
  }

  async function submitTerm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const form = new FormData(event.currentTarget);
      const payload = Object.fromEntries(form.entries());
      const endpoint = editingTerm ? `/api/terms/${editingTerm.id}` : "/api/terms";
      const response = await fetch(endpoint, { method: editingTerm ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json() as { term?: TermRecord; error?: string };
      if (!response.ok || !data.term) throw new Error(data.error || "保存失败");
      setTermDialogOpen(false);
      refresh(`“${data.term.chinese}”已${editingTerm ? "更新" : "加入术语库"}。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "术语保存失败。 ");
    } finally { setSaving(false); }
  }

  async function deleteTerm(term: TermRecord) {
    if (!window.confirm(`确认删除术语“${term.chinese}”吗？此操作不可撤销。`)) return;
    try {
      const response = await fetch(`/api/terms/${term.id}`, { method: "DELETE" });
      const data = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !data.deleted) throw new Error(data.error || "删除失败");
      refresh(`“${term.chinese}”已删除。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "术语删除失败。 "); }
  }

  function editCategory(category: CategoryRecord) {
    setEditingCategoryId(category.id);
    setCategoryDraft({ name: category.name, description: category.description, color: category.color });
  }

  function resetCategoryDraft() {
    setEditingCategoryId(null);
    setCategoryDraft(defaultCategoryDraft);
  }

  async function submitCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const endpoint = editingCategoryId ? `/api/term-categories/${editingCategoryId}` : "/api/term-categories";
      const response = await fetch(endpoint, { method: editingCategoryId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(categoryDraft) });
      const data = await response.json() as { category?: CategoryRecord; updated?: boolean; error?: string };
      if (!response.ok || (!data.category && !data.updated)) throw new Error(data.error || "分类保存失败");
      resetCategoryDraft();
      refresh("分类已保存。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "分类保存失败。 "); }
    finally { setSaving(false); }
  }

  async function deleteCategory(category: CategoryRecord) {
    if (!window.confirm(`确认删除分类“${category.name}”吗？`)) return;
    try {
      const response = await fetch(`/api/term-categories/${category.id}`, { method: "DELETE" });
      const data = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !data.deleted) throw new Error(data.error || "分类删除失败");
      if (activeCategory === category.id) setActiveCategory("all");
      refresh(`分类“${category.name}”已删除。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "分类删除失败。 "); }
  }

  return (
    <SectionFrame id="terminology" eyebrow="TERMINOLOGY DATABASE" title="术语库" lead={`本项目独立维护的术语数据库，当前共 ${total} 个术语、${categories.length} 个分类；支持完整的新增、查询、编辑与删除。`} tone="purple">
      {canEdit && <div className="term-admin-bar">
        <div><span>DATABASE</span><b>独立术语数据表</b><small>所有变更实时保存，不依赖外部项目运行</small></div>
        <div><button type="button" onClick={() => setCategoryDialogOpen(true)}><ActionIcon name="folder" />分类管理</button><button className="primary-button" type="button" onClick={openCreateTerm}><ActionIcon name="add" />新增术语</button></div>
      </div>}
      {notice && <div className="inline-notice" role="status">{notice}<button type="button" onClick={() => setNotice("")}>×</button></div>}
      <div className="term-search-panel">
        <label className="term-search"><span>术语查询</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }} placeholder="输入中文、缩写、英文、定义或应用场景" /><b>{loading ? "读取中" : `${total} 条`}</b></label>
        <p className="term-sort-hint"><span>排序规则</span>默认按词条首字母排序，中文取第一个字的拼音首字母；搜索时相关度优先，同级结果再按首字母排列</p>
        <div className="term-categories">
          <button type="button" className={activeCategory === "all" ? "active" : ""} onClick={() => chooseCategory("all")}><i style={{ background: "#124f9f" }} />全部分类</button>
          {categories.map((category) => <button type="button" className={activeCategory === category.id ? "active" : ""} onClick={() => chooseCategory(category.id)} key={category.id}><i style={{ background: category.color }} />{category.name}<small>{category.termCount}</small></button>)}
        </div>
      </div>
      <div className="term-grid">
        {terms.map((term) => {
          const category = categoryMap.get(term.categoryId);
          return (
            <article className="term-card" key={term.id} style={{ "--term-color": category?.color ?? "#124f9f" } as React.CSSProperties}>
              <div className="term-card-top"><span>{category?.name ?? "未分类"}</span><small>{term.source || "内部维护"}</small></div>
              <h3>{term.chinese}{term.abbreviation && <b>{term.abbreviation}</b>}</h3>
              {term.english && <p className="term-english">{term.english}</p>}
              <p>{term.definition}</p>
              {term.scenario && <div className="term-scenario"><b>工作中</b><span>{term.scenario}</span></div>}
              {canEdit && <div className="term-actions"><button type="button" onClick={() => openEditTerm(term)}><ActionIcon name="edit" />编辑</button><button type="button" onClick={() => deleteTerm(term)}><ActionIcon name="delete" />删除</button></div>}
            </article>
          );
        })}
      </div>
      {!loading && terms.length === 0 && <div className="term-empty"><b>没有找到相关术语</b><span>可以换一个关键词，或直接新增术语。</span></div>}
      {terms.length < total && <button className="load-more" type="button" onClick={() => setLimit((value) => value + PAGE_SIZE)}>继续加载 <span>＋{Math.min(PAGE_SIZE, total - terms.length)}</span></button>}
      <div className="callout callout-amber"><b>使用边界</b><span>定义用于帮助理解行业与项目语境，不自动构成公司产品或合同承诺；低置信词、产品边界和对外口径必须二次确认。</span></div>

      {canEdit && <dialog ref={termDialogRef} className="template-dialog term-dialog" onCancel={() => setTermDialogOpen(false)}>
        <form key={editingTerm?.id ?? "new-term"} className="dialog-shell" onSubmit={submitTerm}>
          <div className="dialog-head"><div><span>TERM RECORD</span><h3>{editingTerm ? "编辑术语" : "新增术语"}</h3><p>字段会保存到本项目的术语数据库。</p></div><button type="button" aria-label="关闭" onClick={() => setTermDialogOpen(false)}>×</button></div>
          <div className="form-grid">
            <label>中文名称<input name="chinese" required defaultValue={editingTerm?.chinese ?? ""} /></label>
            <label>所属分类<select name="categoryId" required defaultValue={editingTerm?.categoryId ?? (activeCategory !== "all" ? activeCategory : categories[0]?.id)}>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
            <label>缩写<input name="abbreviation" defaultValue={editingTerm?.abbreviation ?? ""} placeholder="例如：UAT" /></label>
            <label>英文名称<input name="english" defaultValue={editingTerm?.english ?? ""} placeholder="例如：User Acceptance Testing" /></label>
            <label className="form-wide">定义<textarea name="definition" required rows={4} defaultValue={editingTerm?.definition ?? ""} /></label>
            <label className="form-wide">工作场景<textarea name="scenario" rows={3} defaultValue={editingTerm?.scenario ?? ""} placeholder="项目中何时使用、需要注意什么？" /></label>
            <label className="form-wide">来源<input name="source" defaultValue={editingTerm?.source ?? ""} placeholder="内部制度、产品文档、项目复盘等" /></label>
          </div>
          <div className="dialog-actions"><button type="button" onClick={() => setTermDialogOpen(false)}>取消</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "正在保存……" : "保存术语"}</button></div>
        </form>
      </dialog>}

      {canEdit && <dialog ref={categoryDialogRef} className="template-dialog category-dialog" onCancel={() => setCategoryDialogOpen(false)}>
        <div className="dialog-shell">
          <div className="dialog-head"><div><span>CATEGORY ADMIN</span><h3>分类管理</h3><p>新增、编辑或删除空分类。</p></div><button type="button" aria-label="关闭" onClick={() => setCategoryDialogOpen(false)}>×</button></div>
          <form className="category-form" onSubmit={submitCategory}>
            <label>分类名称<input required value={categoryDraft.name} onChange={(event) => setCategoryDraft((draft) => ({ ...draft, name: event.target.value }))} /></label>
            <label>分类说明<input value={categoryDraft.description} onChange={(event) => setCategoryDraft((draft) => ({ ...draft, description: event.target.value }))} /></label>
            <label>颜色<input type="color" value={categoryDraft.color} onChange={(event) => setCategoryDraft((draft) => ({ ...draft, color: event.target.value }))} /></label>
            <button className="primary-button" type="submit" disabled={saving}>{editingCategoryId ? "保存修改" : "新增分类"}</button>
            {editingCategoryId && <button type="button" onClick={resetCategoryDraft}>取消编辑</button>}
          </form>
          <div className="category-list">
            {categories.map((category) => <div key={category.id}><i style={{ background: category.color }} /><p><b>{category.name}</b><small>{category.description || "暂无说明"} · {category.termCount} 个术语</small></p><button type="button" onClick={() => editCategory(category)}>编辑</button><button className="danger-action" type="button" disabled={category.termCount > 0} title={category.termCount > 0 ? "请先移动或删除分类下的术语" : "删除分类"} onClick={() => deleteCategory(category)}>删除</button></div>)}
          </div>
        </div>
      </dialog>}
    </SectionFrame>
  );
}
