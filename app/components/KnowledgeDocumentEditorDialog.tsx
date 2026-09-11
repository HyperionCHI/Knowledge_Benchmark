"use client";
/* eslint-disable jsx-a11y/no-autofocus -- the nested category dialog intentionally focuses its only text input. */

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { formatFileSize } from "../lib/format";
import { ActionIcon, WorkspaceIcon } from "../lib/workspace-icons";
import {
  DEFAULT_DOCUMENT_TREE_ICON,
  DEFAULT_DOCUMENT_TREE_ICON_COLOR,
  documentTreeColorChoices,
  documentTreeIconChoices,
  documentTreeIconLabels,
  normalizeDocumentTreeIcon,
  normalizeDocumentTreeIconColor,
} from "../lib/knowledge-document-style";
import { CherrySopEditor, type CherrySopEditorHandle } from "./CherrySopEditor";
import { extractObsidianEmbedNames, KnowledgeMarkdown } from "./KnowledgeMarkdown";
import { editorDraftKey, parseEditorDraft, type EditorDraft } from "../lib/editor-draft";

export type KnowledgeAttachment = { id: string; title?: string; summary?: string; content?: string; name: string; attachmentName?: string | null; attachmentSize?: number | null; hasAttachment?: boolean; type: string; size: number; url: string; referenceCount?: number; version?: number; updatedBy?: string; updatedAt?: string };
export type KnowledgeCollaborator = { userId: string; name: string; email: string; permission: "view" | "edit" };
type AttachmentReference = { id: string; title: string; category: string; spaceKind: string; status: string; updatedBy: string; updatedAt: string };
type AttachmentVersion = { id: string; version: number; name: string; content_type: string; size: number; created_by: string; created_at: string };
type AttachmentUploadFailure = { name: string; reason: string };
export type EditableKnowledgeDocument = {
  id: string; title: string; group: string; body: string; items: string[]; attachments: KnowledgeAttachment[]; collaborators?: KnowledgeCollaborator[]; version?: number; status?: "draft" | "published" | "archived"; treeIcon?: string; treeIconColor?: string;
};

type Payload = { title: string; group: string; body: string; items: string[]; attachments: string[]; collaborators: Array<{ userId: string; permission: "view" | "edit" }>; status: "draft" | "published" | "archived"; treeIcon: string; treeIconColor: string; version: number };

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function withoutAttachmentReferences(markdown: string, attachment: KnowledgeAttachment) {
  const assetLink = new RegExp(`\\[[^\n]*?\\]\\(#knowledge-asset-${escapeRegExp(attachment.id)}\\)`, "g");
  const withoutAssetLink = markdown.replace(assetLink, "");
  const withoutEmbed = attachment.name.trim() ? withoutAssetLink.replace(new RegExp(`!\\[\\[${escapeRegExp(attachment.name)}(?:\\|[^]]+)?\\]\\]`, "gi"), "") : withoutAssetLink;
  return withoutEmbed.replace(/\n{3,}/g, "\n\n").trim();
}

export function KnowledgeDocumentEditorDialog({
  record, categories, defaultCategory, scope, draftNamespace, draftOwnerId, brand = "", product = "", title, saveLabel,
  onSave, onEnsureDocument, onClose, onCategoryAction, toast, canManageCategories = true,
}: {
  record: EditableKnowledgeDocument | null;
  categories: string[];
  defaultCategory: string;
  scope: "doc" | "other-doc" | "sop";
  draftNamespace?: string;
  draftOwnerId: string;
  brand?: string;
  product?: string;
  title: string;
  saveLabel: string;
  onSave: (payload: Payload) => Promise<{ id: string } | null>;
  onEnsureDocument: (payload: Payload) => Promise<EditableKnowledgeDocument | null>;
  onClose: () => void;
  onCategoryAction: (action: "create" | "rename" | "delete", name: string, newName?: string) => Promise<boolean>;
  toast: (message: string) => void;
  canManageCategories?: boolean;
}) {
  const initialBody = record?.body || "# 新文档\n\n请在此编写正文。";
  const draftKey = editorDraftKey(draftOwnerId, draftNamespace || scope, brand, product, record?.id);
  const [name, setName] = useState(record?.title || "");
  const [group, setGroup] = useState(record?.group || (categories.includes(defaultCategory) ? defaultCategory : categories[0] || defaultCategory));
  const [draft, setDraft] = useState(initialBody);
  const [recoverableDraft, setRecoverableDraft] = useState<EditorDraft | null>(() => {
    try { return parseEditorDraft(window.localStorage.getItem(draftKey)); } catch { return null; }
  });
  const [restoredAttachmentIds, setRestoredAttachmentIds] = useState<string[] | null>(null);
  const [attachments, setAttachments] = useState<KnowledgeAttachment[]>(record?.attachments || []);
  const [status, setStatus] = useState<"draft" | "published" | "archived">(record?.status || "draft");
  const [treeIcon, setTreeIcon] = useState(() => normalizeDocumentTreeIcon(record?.treeIcon));
  const [treeIconColor, setTreeIconColor] = useState(() => normalizeDocumentTreeIconColor(record?.treeIconColor));
  const [documentId, setDocumentId] = useState(record?.id || "");
  const [library, setLibrary] = useState<KnowledgeAttachment[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryPage, setLibraryPage] = useState(0);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadTitle, setUploadTitle] = useState("");
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [uploadFailures, setUploadFailures] = useState<AttachmentUploadFailure[]>([]);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [resourceFormOpen, setResourceFormOpen] = useState(false);
  const [editingResource, setEditingResource] = useState<KnowledgeAttachment | null>(null);
  const [resourceSaving, setResourceSaving] = useState(false);
  const [previewFor, setPreviewFor] = useState<KnowledgeAttachment | null>(null);
  const [copyId, setCopyId] = useState<string | null>(null);
  const [versionFor, setVersionFor] = useState<KnowledgeAttachment | null>(null);
  const [versions, setVersions] = useState<AttachmentVersion[]>([]);
  const [referencesFor, setReferencesFor] = useState<KnowledgeAttachment | null>(null);
  const [references, setReferences] = useState<AttachmentReference[]>([]);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [categoryBusy, setCategoryBusy] = useState(false);
  const editorRef = useRef<CherrySopEditorHandle>(null);
  const libraryLoadVersion = useRef(0);
  const previousDraftKey = useRef(draftKey);
  const draftFinished = useRef(false);
  const storageWarningShown = useRef(false);
  const flushDraftRef = useRef<(() => void) | null>(null);
  const originalAttachmentIds = useMemo(() => (record?.attachments || []).map((item) => item.id).join("|"), [record]);
  const preservedCollaborators = useMemo(() => (record?.collaborators || []).map((item) => ({ userId: item.userId, permission: item.permission })), [record]);
  const dirty = name !== (record?.title || "") || group !== (record?.group || defaultCategory) || draft !== initialBody || attachments.map((item) => item.id).join("|") !== originalAttachmentIds || pendingDeleteIds.length > 0 || status !== (record?.status || "draft") || treeIcon !== (record?.treeIcon || DEFAULT_DOCUMENT_TREE_ICON) || treeIconColor !== (record?.treeIconColor || DEFAULT_DOCUMENT_TREE_ICON_COLOR);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const flush = () => flushDraftRef.current?.();
    window.addEventListener("pagehide", flush);
    return () => { flush(); window.removeEventListener("pagehide", flush); document.body.style.overflow = previous; };
  }, []);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("workspace-dirty", { detail: dirty }));
    const warnBeforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => { window.removeEventListener("beforeunload", warnBeforeUnload); window.dispatchEvent(new CustomEvent("workspace-dirty", { detail: false })); };
  }, [dirty]);
  useEffect(() => {
    if (!dirty || recoverableDraft || draftFinished.current) return;
    const snapshot: EditorDraft = { title: name, group, body: draft, attachmentIds: restoredAttachmentIds || attachments.map((item) => item.id), pendingDeleteIds, status, treeIcon, treeIconColor, baseVersion: record?.version || 0, savedAt: new Date().toISOString() };
    const persist = () => {
      if (draftFinished.current) return;
      try {
        window.localStorage.setItem(draftKey, JSON.stringify(snapshot));
        if (previousDraftKey.current !== draftKey) window.localStorage.removeItem(previousDraftKey.current);
        previousDraftKey.current = draftKey;
      } catch {
        if (!storageWarningShown.current) { storageWarningShown.current = true; toast("浏览器无法保存本地草稿，请及时保存文章。"); }
      }
    };
    flushDraftRef.current = persist;
    const timer = window.setTimeout(persist, 400);
    return () => { window.clearTimeout(timer); };
  }, [dirty, recoverableDraft, name, group, draft, attachments, restoredAttachmentIds, pendingDeleteIds, status, treeIcon, treeIconColor, record?.version, draftKey, toast]);
  useEffect(() => {
    if (!restoredAttachmentIds || (!libraryLoaded && Boolean(documentId))) return;
    const available = [...(record?.attachments || []), ...library];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Resolve recovered IDs after the asynchronous attachment request completes.
    setAttachments(available.filter((item, index) => restoredAttachmentIds.includes(item.id) && available.findIndex((candidate) => candidate.id === item.id) === index));
    if (restoredAttachmentIds.some((id) => !available.some((item) => item.id === id))) toast("草稿中的部分附件已不存在或无权访问，请重新核对附件引用。");
    setRestoredAttachmentIds(null);
  }, [restoredAttachmentIds, libraryLoaded, library, record?.attachments, documentId, toast]);
  function discardLocalDraft() {
    draftFinished.current = true;
    try { window.localStorage.removeItem(draftKey); window.localStorage.removeItem(previousDraftKey.current); } catch { /* Storage may be disabled. */ }
  }
  function restoreLocalDraft() {
    if (!recoverableDraft) return;
    setName(recoverableDraft.title); setGroup(categories.includes(recoverableDraft.group) ? recoverableDraft.group : defaultCategory);
    setDraft(recoverableDraft.body); setStatus(recoverableDraft.status);
    setTreeIcon(normalizeDocumentTreeIcon(recoverableDraft.treeIcon)); setTreeIconColor(normalizeDocumentTreeIconColor(recoverableDraft.treeIconColor));
    setRestoredAttachmentIds(recoverableDraft.attachmentIds); setPendingDeleteIds(recoverableDraft.pendingDeleteIds);
    setRecoverableDraft(null);
  }
  async function loadLibrary(documentId: string, signal?: AbortSignal) {
    const loadVersion = ++libraryLoadVersion.current;
    const params = new URLSearchParams({ scope, documentId }); if (brand) params.set("brand", brand); if (product) params.set("product", product);
    const response = await fetch(`/api/workspace-attachments?${params}`, { signal });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || "附件库读取失败");
    if (loadVersion === libraryLoadVersion.current) { setLibrary(body.attachments || []); setLibraryLoaded(true); }
  }

  useEffect(() => {
    if (!documentId) return;
    const controller = new AbortController();
    loadLibrary(documentId, controller.signal).catch((error) => { if (error instanceof Error && error.name !== "AbortError") toast(error.message); });
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the listed resource keys fully define this request.
  }, [scope, brand, product, documentId, toast]);
  async function uploadInlineImage(file: File) {
    const form = new FormData(); form.set("scope", scope); form.set("brand", brand); form.set("product", product); if (documentId) form.set("documentId", documentId); form.set("file", file);
    const response = await fetch("/api/inline-images", { method: "POST", body: form });
    const body = await response.json();
    if (!response.ok || !body.image) { toast(body.error || "正文图片上传失败"); return null; }
    toast("图片已插入正文，不计入附件和模板库");
    return body.image as { url: string; name: string };
  }


  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || attachmentBusy) return;
    if (restoredAttachmentIds?.length) return toast("正在核对草稿中的附件，请稍后保存。");
    if (!name.trim() || !draft.trim()) return toast("标题和正文不能为空");
    const embeddedNames = [...new Set(extractObsidianEmbedNames(draft))];
    const embeddedAttachments = embeddedNames.map((embeddedName) => library.find((item) => item.name.replaceAll("\\", "/").split("/").pop()?.trim().toLocaleLowerCase() === embeddedName));
    const missingEmbeds = embeddedNames.filter((_, index) => !embeddedAttachments[index]);
    if (missingEmbeds.length) return toast(`请先在编辑器右侧“附件”中上传这些 Obsidian 嵌入文件：${missingEmbeds.join("、")}`);
    const linkedAttachments = attachments.filter((attachment) => !pendingDeleteIds.includes(attachment.id));
    embeddedAttachments.forEach((attachment) => {
      if (attachment && !linkedAttachments.some((item) => item.id === attachment.id)) linkedAttachments.push(attachment);
    });
    if (linkedAttachments.length > 20) return toast("单篇文档最多引用 20 个附件或模板");
    // Saving may select the saved document and update the URL. Release the
    // navigation guard first, then restore it if persistence fails.
    window.dispatchEvent(new CustomEvent("workspace-dirty", { detail: false }));
    setBusy(true);
    const saved = await onSave({
      title: name.trim(), group, body: draft.trim(), items: [],
      attachments: linkedAttachments.map((item) => item.id), collaborators: preservedCollaborators, status, treeIcon, treeIconColor, version: record?.version || 0,
    });
    setBusy(false);
    if (saved && pendingDeleteIds.length) {
      const failed: string[] = [];
      for (const attachmentId of pendingDeleteIds) {
        const params = new URLSearchParams({ documentId: saved.id });
        const response = await fetch(`/api/workspace-attachments/${attachmentId}?${params}`, { method: "DELETE" });
        if (!response.ok) failed.push(attachmentId);
      }
      setPendingDeleteIds(failed);
      if (failed.length) return toast(`${failed.length} 个附件未能永久删除，文章修改已经保存，可重试删除`);
    }
    if (saved) { discardLocalDraft(); onClose(); }
    else window.dispatchEvent(new CustomEvent("workspace-dirty", { detail: dirty }));
  }

  function close() {
    if (dirty && !window.confirm("有未保存的修改，确认关闭并丢弃本地草稿吗？")) return;
    discardLocalDraft(); onClose();
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const value = categoryDraft.trim(); if (!value) return;
    setCategoryBusy(true); const original = editingCategory;
    const saved = await onCategoryAction(original ? "rename" : "create", original || value, original ? value : undefined);
    setCategoryBusy(false); if (!saved) return;
    if (original && group === original) setGroup(value);
    setEditingCategory(null); setCategoryDraft("");
  }

  async function deleteCategory(category: string) {
    if (!window.confirm(`确认删除空分类“${category}”吗？`)) return;
    setCategoryBusy(true); const deleted = await onCategoryAction("delete", category); setCategoryBusy(false);
    if (deleted && group === category) setGroup(categories.find((item) => item !== category) || defaultCategory);
  }

  const filteredLibrary = library.filter((item) => !pendingDeleteIds.includes(item.id) && (!libraryQuery.trim() || [item.title || "", item.name].join(" ").toLocaleLowerCase().includes(libraryQuery.trim().toLocaleLowerCase())));
  const libraryPageSize = 4, libraryPageCount = Math.max(1, Math.ceil(filteredLibrary.length / libraryPageSize));
  const safeLibraryPage = Math.min(libraryPage, libraryPageCount - 1);
  const pagedLibrary = filteredLibrary.slice(safeLibraryPage * libraryPageSize, (safeLibraryPage + 1) * libraryPageSize);
  function insertFromLibrary(attachment: KnowledgeAttachment) {
    const linked = attachments.some((item) => item.id === attachment.id); if (!linked && attachments.length >= 20) return toast("单篇文档最多引用 20 个附件或模板");
    const label = (attachment.title || attachment.name || "附件资料").replace(/([[\]])/g, "\\$1"), markdown = `[${label}](#knowledge-asset-${attachment.id})`;
    setAttachments((current) => current.some((item) => item.id === attachment.id) ? current : [...current, attachment]);
    if (editorRef.current) editorRef.current.insertAtCursor(markdown);
    else setDraft((current) => `${current.trimEnd()}\n\n${markdown}\n`);
    toast("附件引用已插入当前光标位置");
  }

  async function ensureAttachmentDocument() {
    if (documentId) return { id: documentId };
    const draftTitle = name.trim() || "未命名草稿"; if (!name.trim()) setName(draftTitle);
    const target = await onEnsureDocument({ title: draftTitle, group, body: draft.trim() || "# 新文档", items: [], attachments: attachments.map((item) => item.id), collaborators: preservedCollaborators, status: "draft", treeIcon, treeIconColor, version: 0 });
    if (target) setDocumentId(target.id);
    return target;
  }

  async function uploadAttachments() {
    if (!pendingFiles.length) return toast("请先选择要上传的附件");
    const files = [...pendingFiles], failures: Array<AttachmentUploadFailure & { file: File }> = [];
    let uploadedCount = 0;
    setAttachmentBusy(true);
    setUploadFailures([]); setUploadProgress({ current: 0, total: files.length });
    try {
      const target = await ensureAttachmentDocument(); if (!target) return;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]; setUploadProgress({ current: index + 1, total: files.length });
        const form = new FormData(); form.set("scope", scope); form.set("brand", brand); form.set("product", product); form.set("documentId", target.id); form.set("title", files.length === 1 ? uploadTitle.trim() || file.name : file.name); form.set("file", file);
        try {
          const response = await fetch("/api/workspace-attachments", { method: "POST", body: form });
          const body = await response.json(); if (!response.ok || !body.attachment) throw new Error(body.error || "附件上传失败");
          uploadedCount += 1;
        } catch (error) {
          failures.push({ file, name: file.name, reason: error instanceof Error ? error.message : "附件上传失败" });
        }
      }
      if (uploadedCount) await loadLibrary(target.id);
      setPendingFiles(failures.map((failure) => failure.file));
      setUploadFailures(failures.map(({ name: failedName, reason }) => ({ name: failedName, reason })));
      if (files.length !== 1 || !failures.length) setUploadTitle("");
      if (failures.length) toast(`成功上传 ${uploadedCount} 个，失败 ${failures.length} 个；失败文件已保留，可直接重试`);
      else toast(`已上传 ${uploadedCount} 个附件`);
    } catch (error) { toast(error instanceof Error ? error.message : "附件上传失败"); }
    finally { setAttachmentBusy(false); setUploadProgress(null); }
  }

  async function replaceAttachment(attachment: KnowledgeAttachment, file: File | undefined) {
    if (!file || !documentId) return;
    setAttachmentBusy(true);
    const form = new FormData(); form.set("documentId", documentId); form.set("title", attachment.title || attachment.name); form.set("summary", attachment.summary || ""); form.set("content", attachment.content || ""); form.set("file", file);
    try {
      const response = await fetch(`/api/workspace-attachments/${attachment.id}`, { method: "PUT", body: form });
      const body = await response.json(); if (!response.ok || !body.attachment) throw new Error(body.error || "附件版本更新失败");
      setLibrary((current) => current.map((item) => item.id === attachment.id ? body.attachment : item));
      setAttachments((current) => current.map((item) => item.id === attachment.id ? body.attachment : item)); toast("附件已更新为新版本");
    } catch (error) { toast(error instanceof Error ? error.message : "附件版本更新失败"); }
    finally { setAttachmentBusy(false); }
  }

  function openCreateResource() { setEditingResource(null); setResourceFormOpen(true); }
  function openEditResource(attachment: KnowledgeAttachment) { setEditingResource(attachment); setResourceFormOpen(true); }

  async function saveResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setResourceSaving(true);
    try {
      const target = await ensureAttachmentDocument(); if (!target) return;
      form.set("scope", scope); form.set("brand", brand); form.set("product", product); form.set("documentId", target.id);
      const response = await fetch(editingResource ? `/api/workspace-attachments/${editingResource.id}` : "/api/workspace-attachments", { method: editingResource ? "PUT" : "POST", body: form });
      const body = await response.json(); if (!response.ok || !body.attachment) throw new Error(body.error || "资料保存失败");
      const attachment = body.attachment as KnowledgeAttachment;
      setLibrary((current) => editingResource ? current.map((item) => item.id === attachment.id ? attachment : item) : [attachment, ...current]);
      if (editingResource) setAttachments((current) => current.map((item) => item.id === attachment.id ? attachment : item));
      setResourceFormOpen(false); setEditingResource(null); toast(`“${attachment.title || attachment.name}”已${editingResource ? "更新" : "加入当前文章资料"}`);
    } catch (error) { toast(error instanceof Error ? error.message : "资料保存失败"); }
    finally { setResourceSaving(false); }
  }

  async function copyContent(attachment: KnowledgeAttachment) {
    if (!attachment.content?.trim()) return;
    try {
      await navigator.clipboard.writeText(attachment.content); setCopyId(attachment.id); window.setTimeout(() => setCopyId(null), 1400);
    } catch { toast("浏览器未授权自动复制，请在预览中手动选择文本"); }
  }

  async function openVersions(attachment: KnowledgeAttachment) {
    const response = await fetch(`/api/workspace-attachments/${attachment.id}/versions`), body = await response.json();
    if (!response.ok) return toast(body.error || "附件版本读取失败");
    setVersionFor(attachment); setVersions(body.versions || []);
  }

  async function openReferences(attachment: KnowledgeAttachment) {
    if (!documentId) return;
    setReferencesFor(attachment); setReferences([]); setReferencesLoading(true);
    const params = new URLSearchParams({ documentId });
    const response = await fetch(`/api/workspace-attachments/${attachment.id}/references?${params}`), body = await response.json(); setReferencesLoading(false);
    if (!response.ok) { setReferencesFor(null); return toast(body.error || "引用情况读取失败"); }
    setReferences(body.references || []);
  }

  function unlinkAttachment(attachment: KnowledgeAttachment, permanently = false) {
    if (permanently && !window.confirm(`确认永久删除“${attachment.title || attachment.name}”及其历史版本吗？正文中的全部引用也会移除。`)) return;
    setDraft((current) => withoutAttachmentReferences(current, attachment));
    setAttachments((current) => current.filter((item) => item.id !== attachment.id));
    if (permanently) setPendingDeleteIds((current) => current.includes(attachment.id) ? current : [...current, attachment.id]);
    toast(permanently ? "附件将在保存文章后永久删除" : "已移除正文中的全部引用，附件文件仍保留");
  }

  async function importMarkdown(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLocaleLowerCase().endsWith(".md") && !["text/markdown", "text/plain"].includes(file.type)) return toast("请选择 Markdown（.md）文件");
    const markdown = (await file.text()).replace(/^\uFEFF/, "");
    if (!markdown.trim()) return toast("Markdown 文件内容为空");
    setDraft(markdown);
    toast(`已导入 ${file.name}，请在保存前检查右侧统一预览`);
  }

  const pendingFileNames = pendingFiles.map((file) => file.name).join("\n");
  const pendingFileLabel = pendingFiles.length > 1 ? `已选择 ${pendingFiles.length} 个文件` : pendingFiles[0]?.name || "选择文件";

  return <div className="modal-backdrop document-editor-backdrop"><form className="modal doc-editor-modal cherry-doc-modal" onSubmit={submit}>
    <header><div><span>CHERRY DOCUMENT EDITOR</span><h2>{title}</h2><p>正文与预览是主工作区；附件上传后可按需插入当前光标位置。</p>{recoverableDraft && <div className="editor-draft-recovery" role="status"><span>{recoverableDraft.baseVersion !== (record?.version || 0) ? "文章版本已变化，恢复旧草稿后请核对最新内容。" : "发现未保存的本地草稿。"}</span><button type="button" onClick={restoreLocalDraft}>恢复草稿</button><button type="button" onClick={() => { try { window.localStorage.removeItem(draftKey); } catch { /* Storage may be disabled. */ } setRecoverableDraft(null); }}>使用当前文章</button></div>}</div><button className="icon-button" title="关闭" type="button" onClick={close}><ActionIcon name="close" /></button></header>
    <div className="doc-editor-fields">
      <label>文档标题<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>所属分类<div className="doc-category-field"><select required value={group} onChange={(event) => setGroup(event.target.value)}>{categories.map((category) => <option value={category} key={category}>{category}</option>)}</select>{canManageCategories && <button type="button" onClick={() => setCategoryManagerOpen(true)}><ActionIcon name="folder" />分类</button>}</div></label>
      <label>发布状态<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="draft">草稿 · 仅已授权人员可见</option><option value="published">已发布 · 授权范围内可见</option><option value="archived">已归档 · 仅已授权人员可见</option></select></label>
      <div className="document-tree-style-field"><span>文件树样式</span><details><summary title="设置左侧文件树图标和颜色"><i style={{ color: treeIconColor }}><WorkspaceIcon name={treeIcon} size={16} /></i><b>图标与颜色</b><ActionIcon name="expand" size={13} /></summary><div className="document-tree-style-popover"><b>选择图标</b><div className="document-tree-icon-grid">{documentTreeIconChoices.map((icon) => <button type="button" className={treeIcon === icon ? "active" : ""} aria-label={`选择${documentTreeIconLabels[icon]}图标`} title={documentTreeIconLabels[icon]} onClick={() => setTreeIcon(icon)} key={icon}><WorkspaceIcon name={icon} size={17} /></button>)}</div><b>选择颜色</b><div className="document-tree-color-grid">{documentTreeColorChoices.map((color) => <button type="button" className={treeIconColor === color ? "active" : ""} aria-label={`选择图标颜色 ${color}`} title={color} style={{ backgroundColor: color }} onClick={() => setTreeIconColor(color)} key={color} />)}<label title="自定义图标颜色"><input aria-label="自定义图标颜色" type="color" value={treeIconColor} onChange={(event) => setTreeIconColor(event.target.value.toLowerCase())} /></label></div><button className="document-tree-style-reset" type="button" onClick={() => { setTreeIcon(DEFAULT_DOCUMENT_TREE_ICON); setTreeIconColor(DEFAULT_DOCUMENT_TREE_ICON_COLOR); }}>恢复默认</button></div></details></div>
      <label className="markdown-import-control">导入 Markdown<input type="file" accept=".md,text/markdown,text/plain" onChange={(event) => { void importMarkdown(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
    </div>
    <div className={`doc-editor-workspace ${attachmentsOpen ? "attachments-open" : "attachments-collapsed"}`}>
      <CherrySopEditor ref={editorRef} value={draft} onChange={setDraft} onImageUpload={uploadInlineImage} attachments={library} />
      <aside className={`doc-editor-side ${attachmentsOpen ? "open" : "collapsed"}`}>
        {!attachmentsOpen ? <button className="doc-editor-side-toggle" type="button" aria-expanded="false" aria-label={`展开附件，共 ${library.length} 个`} title="展开附件" onClick={() => setAttachmentsOpen(true)}><WorkspaceIcon name="docs" /><span>附件</span>{library.length > 0 && <small>{library.length}</small>}</button> : <>
          <header className="doc-editor-side-head"><div><WorkspaceIcon name="docs" /><b>附件</b><small>{library.length} 个</small></div><div className="doc-editor-side-head-actions"><button type="button" title="新增附件或文本资料" onClick={openCreateResource}><ActionIcon name="add" /></button><button type="button" aria-expanded="true" aria-label="收起附件" title="收起附件" onClick={() => setAttachmentsOpen(false)}><ActionIcon name="close" /></button></div></header>
          <section className="editor-attachment-panel">
          <div className="editor-attachment-upload"><div><input value={uploadTitle} disabled={attachmentBusy || pendingFiles.length > 1} placeholder={pendingFiles.length > 1 ? "批量上传使用各文件名" : "附件显示名称（可选）"} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} onChange={(event) => setUploadTitle(event.target.value)} /><label title={pendingFileNames || "选择附件，可多选"} aria-disabled={attachmentBusy}><ActionIcon name="folder" /><span>{pendingFileLabel}</span><input type="file" multiple disabled={attachmentBusy} onChange={(event) => { const files = Array.from(event.currentTarget.files || []); setPendingFiles(files); setUploadFailures([]); if (files.length !== 1) setUploadTitle(""); event.currentTarget.value = ""; }} /></label></div><button className="primary" type="button" disabled={attachmentBusy || !pendingFiles.length} onClick={() => void uploadAttachments()}><ActionIcon name="upload" />{attachmentBusy && uploadProgress ? `上传 ${uploadProgress.current}/${uploadProgress.total}` : pendingFiles.length > 1 ? `上传（${pendingFiles.length}）` : "上传"}</button></div>
          {uploadFailures.length > 0 && <div className="editor-upload-failures" title={uploadFailures.map((failure) => `${failure.name}：${failure.reason}`).join("\n")}><span>{uploadFailures.length} 个文件上传失败，已保留可重试</span><button type="button" disabled={attachmentBusy} onClick={() => { setPendingFiles([]); setUploadFailures([]); setUploadTitle(""); }}>清空</button></div>}
          <label className="editor-attachment-search"><ActionIcon name="search" /><input value={libraryQuery} placeholder="搜索当前文章附件或文本资料" onChange={(event) => { setLibraryQuery(event.target.value); setLibraryPage(0); }} /></label>
          <div className="editor-attachment-list">{pagedLibrary.length ? pagedLibrary.map((attachment) => {
            const linked = attachments.some((item) => item.id === attachment.id), hasContent = Boolean(attachment.content?.trim()), hasAttachment = attachment.hasAttachment !== false && Boolean(attachment.name && attachment.size > 0);
            return <article key={attachment.id}><span><WorkspaceIcon name={hasContent ? "templates" : "docs"} /></span><div><b title={attachment.title || attachment.name}>{attachment.title || attachment.name}</b><small>{hasAttachment ? `${attachment.name} · ${formatFileSize(attachment.size)} · v${attachment.version || 1}` : "纯文本资料"}{linked ? " · 正文已引用" : ""}</small></div><nav><button type="button" title="插入当前光标位置" onClick={() => insertFromLibrary(attachment)}><ActionIcon name="copy" /></button>{hasContent && <button type="button" title="预览文本资料" onClick={() => setPreviewFor(attachment)}><ActionIcon name="show" /></button>}{hasAttachment && <a href={attachment.url} target="_blank" rel="noreferrer" title="下载或预览附件"><ActionIcon name="download" /></a>}<details className="editor-attachment-more"><summary title="更多附件操作"><ActionIcon name="menu" /></summary><div><button type="button" onClick={() => openEditResource(attachment)}><ActionIcon name="edit" />编辑资料</button>{hasAttachment && <button type="button" onClick={() => void openVersions(attachment)}><ActionIcon name="refresh" />历史版本</button>}<button type="button" onClick={() => void openReferences(attachment)}><ActionIcon name="users" />引用情况</button>{hasAttachment && <label><ActionIcon name="upload" />上传新版本<input type="file" onChange={(event) => { void replaceAttachment(attachment, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>}{linked && <button type="button" onClick={() => unlinkAttachment(attachment)}><ActionIcon name="close" />解除正文引用</button>}<button type="button" className="danger-action" onClick={() => unlinkAttachment(attachment, true)}><ActionIcon name="delete" />保存后永久删除</button></div></details></nav></article>;
          }) : <div className="editor-side-empty">当前文章还没有附件或文本资料</div>}</div>
          <footer className="editor-side-pager"><span>第 {safeLibraryPage + 1} / {libraryPageCount} 页 · {attachments.length} 项正文引用</span><div><button type="button" disabled={safeLibraryPage === 0} onClick={() => setLibraryPage((page) => Math.max(0, page - 1))}>‹</button><button type="button" disabled={safeLibraryPage + 1 >= libraryPageCount} onClick={() => setLibraryPage((page) => Math.min(libraryPageCount - 1, page + 1))}>›</button></div></footer>
          {pendingDeleteIds.length > 0 && <div className="editor-delete-notice"><span>{pendingDeleteIds.length} 个附件将在保存后永久删除</span><button type="button" onClick={() => setPendingDeleteIds([])}>改为保留文件</button></div>}
          </section>
        </>}
      </aside>
    </div>
    <footer className="dialog-actions doc-editor-actions"><span>{record?.id ? "文章附件可直接维护" : "首次上传附件时会自动创建草稿"}</span><button type="button" onClick={close}>取消</button><button className="primary" disabled={busy || attachmentBusy || !draft.trim()}><ActionIcon name="save" />{busy ? "正在保存…" : saveLabel}</button></footer>
  </form>
  {resourceFormOpen && <div className="modal-backdrop resource-template-backdrop"><form key={editingResource?.id || "new-resource"} className="modal resource-template-modal" onSubmit={saveResource}>
    <header><div><span>ARTICLE RESOURCE</span><h2>{editingResource ? "编辑附件或文本资料" : "新增附件或文本资料"}</h2><p>名称必填；文本内容和附件至少提供一项。保存后可从右侧插入正文。</p></div><button className="icon-button" type="button" title="关闭" onClick={() => { setResourceFormOpen(false); setEditingResource(null); }}><ActionIcon name="close" /></button></header>
    <div className="form-grid resource-template-form">
      <label className="form-wide">显示名称<input name="title" required maxLength={80} defaultValue={editingResource?.title || editingResource?.name || ""} placeholder="例如：项目上线检查清单" /></label>
      <label className="form-wide">一句话说明<input name="summary" maxLength={160} defaultValue={editingResource?.summary || ""} placeholder="说明这份资料的用途或适用场景" /></label>
      <label className="form-wide">文本内容 <small>可选；填写后支持 Markdown 预览和复制</small><textarea name="content" rows={10} defaultValue={editingResource?.content || ""} placeholder="粘贴可复用的正文内容，支持 Markdown……" /></label>
      <label className="form-wide file-field"><span>{editingResource?.hasAttachment ? "替换附件" : "上传附件"} <small>可选，最大 200 MB，禁止脚本和可执行文件</small></span><input name="file" type="file" /></label>
      {editingResource?.hasAttachment && <label className="remove-file"><input name="removeAttachment" value="true" type="checkbox" />移除现有附件，仅保留文本资料：{editingResource.name}</label>}
    </div>
    <footer className="dialog-actions"><button type="button" onClick={() => { setResourceFormOpen(false); setEditingResource(null); }}>取消</button><button className="primary" disabled={resourceSaving}><ActionIcon name="save" />{resourceSaving ? "正在保存…" : "保存资料"}</button></footer>
  </form></div>}
  {previewFor && <div className="modal-backdrop resource-template-backdrop"><section className="modal editor-resource-preview-modal"><header><div><span>RESOURCE PREVIEW</span><h2>{previewFor.title || previewFor.name}</h2><p>{previewFor.summary || "当前文章的可复用文本资料"}</p></div><button className="icon-button" type="button" title="关闭" onClick={() => setPreviewFor(null)}><ActionIcon name="close" /></button></header><div className="editor-resource-preview ionic-doc-theme"><KnowledgeMarkdown markdown={previewFor.content || ""} /></div><footer className="dialog-actions"><button type="button" onClick={() => void copyContent(previewFor)}><ActionIcon name={copyId === previewFor.id ? "check" : "copy"} />{copyId === previewFor.id ? "已复制" : "复制文本"}</button><button className="primary" type="button" onClick={() => setPreviewFor(null)}>关闭</button></footer></section></div>}
  {referencesFor && <div className="modal-backdrop"><section className="modal attachment-reference-modal"><header><div><span>RESOURCE REFERENCES</span><h2>引用情况</h2><p>“{referencesFor.title || referencesFor.name}”当前被哪些文章引用。</p></div><button className="icon-button" type="button" title="关闭" onClick={() => setReferencesFor(null)}><ActionIcon name="close" /></button></header><section className="attachment-reference-panel">{referencesLoading ? <div className="doc-attachment-empty">正在读取…</div> : references.length ? <div>{references.map((reference) => <article key={reference.id}><span><WorkspaceIcon name="docs" /></span><div><b>{reference.title}</b><small>{reference.category} · {reference.spaceKind === "sop" ? "SOP" : "知识资料"} · {reference.updatedBy}</small></div></article>)}</div> : <div className="doc-attachment-empty">当前没有文章引用该资源</div>}</section></section></div>}
  {versionFor && <div className="modal-backdrop"><section className="modal attachment-version-modal"><header><div><span>ATTACHMENT HISTORY</span><h2>{versionFor.title || versionFor.name}</h2><p>当前附件 v{versionFor.version || 1}；历史版本可单独下载。</p></div><button className="icon-button" type="button" title="关闭" onClick={() => setVersionFor(null)}><ActionIcon name="close" /></button></header><div className="attachment-version-list">{versions.length ? versions.map((version) => <article key={version.id}><b>v{version.version}</b><div><strong>{version.name}</strong><small>{version.created_by} · {new Date(version.created_at).toLocaleString("zh-CN")} · {formatFileSize(version.size)}</small></div><a href={`/api/workspace-attachments/${versionFor.id}?version=${version.version}`} download><ActionIcon name="download" />下载</a></article>) : <div className="doc-attachment-empty">暂无历史版本</div>}</div></section></div>}
  {categoryManagerOpen && <div className="modal-backdrop category-manager-backdrop"><section className="modal category-manager-modal"><header><div><span>DOCUMENT CATEGORIES</span><h2>分类管理</h2><p>分类是当前知识空间的文档目录；有内容的分类不能删除。</p></div><button className="icon-button" title="关闭" type="button" onClick={() => { setCategoryManagerOpen(false); setEditingCategory(null); setCategoryDraft(""); }}><ActionIcon name="close" /></button></header><form className="doc-category-form" onSubmit={saveCategory}><label>{editingCategory ? "新的分类名称" : "新增分类"}<input autoFocus value={categoryDraft} maxLength={40} onChange={(event) => setCategoryDraft(event.target.value)} /></label><div>{editingCategory && <button type="button" onClick={() => { setEditingCategory(null); setCategoryDraft(""); }}>取消编辑</button>}<button className="primary" disabled={categoryBusy || !categoryDraft.trim()}><ActionIcon name={editingCategory ? "save" : "add"} />{editingCategory ? "保存修改" : "新增分类"}</button></div></form><div className="doc-category-list">{categories.map((category) => <article key={category}><div><b>{category}</b></div><button type="button" disabled={categoryBusy} onClick={() => { setEditingCategory(category); setCategoryDraft(category); }}><ActionIcon name="edit" />重命名</button><button type="button" className="danger-action" disabled={categoryBusy || categories.length <= 1} onClick={() => void deleteCategory(category)}><ActionIcon name="delete" />删除</button></article>)}</div></section></div>}
  </div>;
}
