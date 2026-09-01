"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { KnowledgeMarkdown } from "../../components/KnowledgeMarkdown";
import { HighlightedText, SectionFrame, resultExcerpt } from "../../components/SectionFrame";
import { ActionIcon } from "../../lib/workspace-icons";
import type { TemplateCategory, TemplateRecord } from "./types";

const emptyCategoryDraft = { name: "", description: "", color: "#124f9f" };

function formatFileSize(size: number | null) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function TemplateLibrary({ searchQuery = "", canEdit = false }: { searchQuery?: string; canEdit?: boolean }) {
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [categories, setCategories] = useState<TemplateCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TemplateRecord | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState(emptyCategoryDraft);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copyId, setCopyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const categoryDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/templates").then((response) => response.json().then((data) => ({ ok: response.ok, data }))),
      fetch("/api/template-categories").then((response) => response.json().then((data) => ({ ok: response.ok, data }))),
      fetch("/api/preferences?key=template-order").then((response) => response.json().then((data) => ({ ok: response.ok, data }))),
    ]).then(([templateResult, categoryResult, preferenceResult]) => {
      if (!templateResult.ok) throw new Error(templateResult.data.error || "模板读取失败");
      if (!categoryResult.ok) throw new Error(categoryResult.data.error || "分类读取失败");
      const records = templateResult.data.templates ?? [];
      const position = new Map<string, number>((preferenceResult.ok ? preferenceResult.data.ids || [] : []).map((id: string, index: number) => [id, index]));
      setTemplates([...records].sort((left: TemplateRecord, right: TemplateRecord) => (position.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(right.id) ?? Number.MAX_SAFE_INTEGER)));
      setCategories(categoryResult.data.categories ?? []);
    }).catch((error) => setNotice(error instanceof Error ? error.message : "模板库读取失败。"))
      .finally(() => setLoading(false));
  }, [reloadToken]);

  useEffect(() => { if (dialogOpen) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [dialogOpen]);
  useEffect(() => { if (categoryDialogOpen) categoryDialogRef.current?.showModal(); else categoryDialogRef.current?.close(); }, [categoryDialogOpen]);

  const visibleTemplates = useMemo(() => {
    const categoryTemplates = activeCategory === "all" ? templates : templates.filter((template) => template.categoryId === activeCategory);
    const normalized = searchQuery.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return categoryTemplates;
    return categoryTemplates.filter((template) => [template.title, template.category, template.summary, template.content, template.attachmentName ?? ""].join(" ").toLocaleLowerCase("zh-CN").includes(normalized));
  }, [activeCategory, searchQuery, templates]);
  const categoryMap = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);

  function refresh(message?: string) {
    setReloadToken((value) => value + 1);
    if (message) setNotice(message);
  }

  function openCreateTemplate() {
    setEditingTemplate(null);
    setDialogOpen(true);
  }

  function openEditTemplate(template: TemplateRecord) {
    setEditingTemplate(template);
    setDialogOpen(true);
  }

  async function copyTemplate(template: TemplateRecord) {
    try {
      await navigator.clipboard.writeText(template.content);
      setCopyId(template.id);
      window.setTimeout(() => setCopyId(null), 1400);
    } catch { setNotice("浏览器未授权自动复制，请展开模板后手动选择文本。 "); }
  }

  async function submitTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice("");
    try {
      const form = event.currentTarget;
      const formData = new FormData(form);
      const content = String(formData.get("content") ?? "").trim();
      const attachment = formData.get("attachment");
      const hasNewAttachment = attachment instanceof File && attachment.size > 0;
      const keepsCurrentAttachment = Boolean(editingTemplate?.attachmentName) && formData.get("removeAttachment") !== "true";
      if (!content && !hasNewAttachment && !keepsCurrentAttachment) throw new Error("文本内容和附件至少需要填写一项。");
      const endpoint = editingTemplate ? `/api/templates/${editingTemplate.id}` : "/api/templates";
      const response = await fetch(endpoint, { method: editingTemplate ? "PUT" : "POST", body: formData });
      const data = await response.json() as { template?: TemplateRecord; error?: string };
      if (!response.ok || !data.template) throw new Error(data.error || "保存失败");
      setActiveCategory("all");
      setDialogOpen(false);
      refresh(`“${data.template.title}”已${editingTemplate ? "更新" : "加入模板库"}。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "模板保存失败。 "); }
    finally { setSaving(false); }
  }

  async function deleteTemplate(template: TemplateRecord) {
    if (!window.confirm(`确认删除“${template.title}”及其附件吗？此操作不可撤销。`)) return;
    try {
      const response = await fetch(`/api/templates/${template.id}`, { method: "DELETE" });
      const data = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !data.deleted) throw new Error(data.error || "删除失败");
      if (expandedId === template.id) setExpandedId(null);
      refresh(`“${template.title}”已删除。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "模板删除失败。 "); }
  }

  function editCategory(category: TemplateCategory) {
    setEditingCategoryId(category.id);
    setCategoryDraft({ name: category.name, description: category.description, color: category.color });
  }

  function resetCategoryDraft() {
    setEditingCategoryId(null);
    setCategoryDraft(emptyCategoryDraft);
  }

  async function submitCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const endpoint = editingCategoryId ? `/api/template-categories/${editingCategoryId}` : "/api/template-categories";
      const response = await fetch(endpoint, { method: editingCategoryId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(categoryDraft) });
      const data = await response.json() as { category?: TemplateCategory; updated?: boolean; error?: string };
      if (!response.ok || (!data.category && !data.updated)) throw new Error(data.error || "分类保存失败");
      resetCategoryDraft();
      refresh("模板分类已保存。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "分类保存失败。 "); }
    finally { setSaving(false); }
  }

  async function deleteCategory(category: TemplateCategory) {
    if (!window.confirm(`确认删除分类“${category.name}”吗？`)) return;
    try {
      const response = await fetch(`/api/template-categories/${category.id}`, { method: "DELETE" });
      const data = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !data.deleted) throw new Error(data.error || "分类删除失败");
      if (activeCategory === category.id) setActiveCategory("all");
      refresh(`分类“${category.name}”已删除。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "分类删除失败。 "); }
  }

  async function reorderTemplate(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const source = templates.find((item) => item.id === dragId), target = templates.find((item) => item.id === targetId); if (!source || !target) return;
    const next = templates.filter((item) => item.id !== source.id); next.splice(next.findIndex((item) => item.id === target.id), 0, source); setTemplates(next); setDragId(null); setOverId(null);
    try { const response = await fetch("/api/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "template-order", ids: next.map((item) => item.id) }) }); if (!response.ok) throw new Error((await response.json()).error || "排序保存失败"); setNotice("个人模板排序已保存。"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "排序保存失败。"); }
  }

  return (
    <SectionFrame id="templates" eyebrow="REUSABLE ASSETS" title="通用附件及模板" lead="附件、模板与分类均由本项目数据库独立维护，支持新增、查询、编辑、删除、附件上传下载及文本复制。" tone="amber">
      <div className="template-toolbar">
        <div className="filter-row term-categories" aria-label="模板分类">
          <button type="button" className={activeCategory === "all" ? "active" : ""} onClick={() => setActiveCategory("all")}><i style={{ background: "#124f9f" }} />全部分类 <small>{templates.length}</small></button>
          {categories.map((category) => <button type="button" className={activeCategory === category.id ? "active" : ""} onClick={() => setActiveCategory(category.id)} key={category.id}><i style={{ background: category.color }} />{category.name} <small>{category.templateCount}</small></button>)}
        </div>
        {canEdit && <div className="template-admin-actions"><button type="button" onClick={() => setCategoryDialogOpen(true)}><ActionIcon name="folder" />分类管理</button><button className="primary-button" type="button" onClick={openCreateTemplate}><ActionIcon name="add" />新建模板</button></div>}
      </div>
      {notice && <div className="inline-notice" role="status">{notice}<button type="button" onClick={() => setNotice("")}>×</button></div>}
      {searchQuery.trim() && <div className="search-results-head" aria-live="polite"><span>附件及模板检索</span><b>{loading ? "读取中" : `找到 ${visibleTemplates.length} 条`}</b></div>}
      <div className="template-grid">
        {visibleTemplates.map((template) => {
          const category = categoryMap.get(template.categoryId);
          const hasContent = Boolean(template.content.trim());
          return (
            <article draggable={!searchQuery.trim()} onDragStart={() => setDragId(template.id)} onDragEnter={() => dragId && setOverId(template.id)} onDragOver={(event) => event.preventDefault()} onDragEnd={() => { setDragId(null); setOverId(null); }} onDrop={() => reorderTemplate(template.id)} className={`template-card ${dragId === template.id ? "sorting-drag" : ""} ${overId === template.id ? "sorting-over" : ""}`} key={template.id} style={{ "--template-color": category?.color ?? "#124f9f" } as React.CSSProperties}>
              <div className="template-card-top"><span><HighlightedText text={template.category} query={searchQuery.trim()} /></span></div>
              <h3><HighlightedText text={template.title} query={searchQuery.trim()} /></h3><p><HighlightedText text={template.summary || "团队可复用模板"} query={searchQuery.trim()} /></p>
              {searchQuery.trim() && <div className="template-search-context"><HighlightedText text={resultExcerpt(`${template.content} ${template.attachmentName ?? ""}`, searchQuery.trim())} query={searchQuery.trim()} /></div>}
              {template.attachmentName && <div className="attachment-line"><span aria-hidden="true">↳</span><div><b>{template.attachmentName}</b><small>{formatFileSize(template.attachmentSize)}</small></div></div>}
              {hasContent && expandedId === template.id && <div className="template-preview"><KnowledgeMarkdown className="template-preview-content ionic-doc-theme" markdown={template.content} /></div>}
              <div className="template-actions">
                {hasContent && <button type="button" onClick={() => setExpandedId(expandedId === template.id ? null : template.id)}><ActionIcon name={expandedId === template.id ? "hide" : "show"} />{expandedId === template.id ? "收起" : "预览"}</button>}
                {hasContent && <button type="button" onClick={() => copyTemplate(template)}><ActionIcon name={copyId === template.id ? "check" : "copy"} />{copyId === template.id ? "已复制" : "复制文本"}</button>}
                {template.attachmentName && <a href={`/api/templates/${template.id}/attachment`} download><ActionIcon name="download" />下载附件</a>}
                {canEdit && <><button type="button" onClick={() => openEditTemplate(template)}><ActionIcon name="edit" />编辑</button>
                <button className="danger-action" type="button" onClick={() => deleteTemplate(template)}><ActionIcon name="delete" />删除</button></>}
              </div>
            </article>
          );
        })}
      </div>
      {!loading && visibleTemplates.length === 0 && <div className="term-empty"><b>{searchQuery.trim() ? `没有找到“${searchQuery.trim()}”` : "当前分类还没有模板"}</b><span>{searchQuery.trim() ? "换一个关键词，或清空顶部搜索查看全部模板。" : "可以新建模板，或切换到其他分类。"}</span></div>}

      {canEdit && <dialog ref={dialogRef} className="template-dialog" onCancel={() => setDialogOpen(false)}>
        <form key={editingTemplate?.id ?? "new-template"} className="dialog-shell" onSubmit={submitTemplate}>
          <div className="dialog-head"><div><span>TEMPLATE RECORD</span><h3>{editingTemplate ? "编辑模板" : "新建模板"}</h3><p>文本内容和附件至少提供一项，分类等信息会保存到本项目数据库。</p></div><button type="button" aria-label="关闭" onClick={() => setDialogOpen(false)}>×</button></div>
          <div className="form-grid">
            <label>模板名称<input name="title" required maxLength={80} defaultValue={editingTemplate?.title ?? ""} placeholder="例如：上线切换方案" /></label>
            <label>分类<select name="categoryId" required defaultValue={editingTemplate?.categoryId ?? (activeCategory !== "all" ? activeCategory : categories[0]?.id)}>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
            <label className="form-wide">一句话说明<input name="summary" maxLength={160} defaultValue={editingTemplate?.summary ?? ""} placeholder="这个模板在什么时候使用？" /></label>
            <label className="form-wide">文本内容 <small>与附件至少填写一项</small><textarea name="content" rows={10} defaultValue={editingTemplate?.content ?? ""} placeholder="粘贴可复用的模板正文……" /></label>
            <label className="form-wide file-field"><span>{editingTemplate?.attachmentName ? "替换附件" : "上传附件"} <small>与文本内容至少填写一项；最大 200 MB，禁止脚本和可执行文件</small></span><input name="attachment" type="file" /></label>
            {editingTemplate?.attachmentName && <label className="remove-file"><input name="removeAttachment" value="true" type="checkbox" /> 删除现有附件：{editingTemplate.attachmentName}</label>}
          </div>
          <div className="dialog-actions"><button type="button" onClick={() => setDialogOpen(false)}>取消</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "正在保存……" : "保存模板"}</button></div>
        </form>
      </dialog>}

      {canEdit && <dialog ref={categoryDialogRef} className="template-dialog category-dialog" onCancel={() => setCategoryDialogOpen(false)}>
        <div className="dialog-shell">
          <div className="dialog-head"><div><span>CATEGORY ADMIN</span><h3>模板分类管理</h3><p>分类名称、说明和颜色均可维护。</p></div><button type="button" aria-label="关闭" onClick={() => setCategoryDialogOpen(false)}>×</button></div>
          <form className="category-form" onSubmit={submitCategory}>
            <label>分类名称<input required value={categoryDraft.name} onChange={(event) => setCategoryDraft((draft) => ({ ...draft, name: event.target.value }))} /></label>
            <label>分类说明<input value={categoryDraft.description} onChange={(event) => setCategoryDraft((draft) => ({ ...draft, description: event.target.value }))} /></label>
            <label>颜色<input type="color" value={categoryDraft.color} onChange={(event) => setCategoryDraft((draft) => ({ ...draft, color: event.target.value }))} /></label>
            <button className="primary-button" type="submit" disabled={saving}>{editingCategoryId ? "保存修改" : "新增分类"}</button>
            {editingCategoryId && <button type="button" onClick={resetCategoryDraft}>取消编辑</button>}
          </form>
          <div className="category-list">
            {categories.map((category) => <div key={category.id}><i style={{ background: category.color }} /><p><b>{category.name}</b><small>{category.description || "暂无说明"} · {category.templateCount} 个模板</small></p><button type="button" onClick={() => editCategory(category)}>编辑</button><button className="danger-action" type="button" disabled={category.templateCount > 0} title={category.templateCount > 0 ? "请先移动或删除分类下的模板" : "删除分类"} onClick={() => deleteCategory(category)}>删除</button></div>)}
          </div>
        </div>
      </dialog>}
    </SectionFrame>
  );
}
