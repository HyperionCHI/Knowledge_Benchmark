"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { DEFAULT_CATEGORY_COLOR } from "../lib/category-validation";

export type ManagedCategory = {
  id: string;
  name: string;
  description: string;
  color: string;
  count: number;
};

const emptyDraft = { name: "", description: "", color: DEFAULT_CATEGORY_COLOR };

export function CategoryManagerDialog({
  open,
  title,
  description,
  itemLabel,
  endpoint,
  categories,
  onClose,
  onChanged,
  onDeleted,
  onNotice,
}: {
  open: boolean;
  title: string;
  description: string;
  itemLabel: string;
  endpoint: string;
  categories: ManagedCategory[];
  onClose: () => void;
  onChanged: (message: string) => void;
  onDeleted?: (categoryId: string) => void;
  onNotice: (message: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [open]);

  function resetDraft() {
    setEditingId(null);
    setDraft(emptyDraft);
  }

  function editCategory(category: ManagedCategory) {
    setEditingId(category.id);
    setDraft({ name: category.name, description: category.description, color: category.color });
  }

  async function submitCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const url = editingId ? `${endpoint}/${editingId}` : endpoint;
      const response = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await response.json() as { category?: ManagedCategory; updated?: boolean; error?: string };
      if (!response.ok || (!data.category && !data.updated)) throw new Error(data.error || "分类保存失败");
      resetDraft();
      onChanged(`${title}已保存。`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "分类保存失败。 ");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCategory(category: ManagedCategory) {
    if (!window.confirm(`确认删除分类“${category.name}”吗？`)) return;
    try {
      const response = await fetch(`${endpoint}/${category.id}`, { method: "DELETE" });
      const data = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !data.deleted) throw new Error(data.error || "分类删除失败");
      if (editingId === category.id) resetDraft();
      onDeleted?.(category.id);
      onChanged(`分类“${category.name}”已删除。`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "分类删除失败。 ");
    }
  }

  return (
    <dialog ref={dialogRef} className="template-dialog category-dialog" onCancel={onClose}>
      <div className="dialog-shell">
        <div className="dialog-head"><div><span>CATEGORY ADMIN</span><h3>{title}</h3><p>{description}</p></div><button type="button" aria-label="关闭" onClick={onClose}>×</button></div>
        <form className="category-form" onSubmit={submitCategory}>
          <label>分类名称<input required value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} /></label>
          <label>分类说明<input value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} /></label>
          <label>颜色<input type="color" value={draft.color} onChange={(event) => setDraft((value) => ({ ...value, color: event.target.value }))} /></label>
          <button className="primary-button" type="submit" disabled={saving}>{editingId ? "保存修改" : "新增分类"}</button>
          {editingId && <button type="button" onClick={resetDraft}>取消编辑</button>}
        </form>
        <div className="category-list">
          {categories.map((category) => <div key={category.id}><i style={{ background: category.color }} /><p><b>{category.name}</b><small>{category.description || "暂无说明"} · {category.count} 个{itemLabel}</small></p><button type="button" onClick={() => editCategory(category)}>编辑</button><button className="danger-action" type="button" disabled={category.count > 0} title={category.count > 0 ? `请先移动或删除分类下的${itemLabel}` : "删除分类"} onClick={() => deleteCategory(category)}>删除</button></div>)}
        </div>
      </div>
    </dialog>
  );
}
