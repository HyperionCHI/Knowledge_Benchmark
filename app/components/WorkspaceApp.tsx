"use client";
/* eslint-disable jsx-a11y/no-autofocus -- search dialogs intentionally focus their only text input. */

import { FormEvent, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { TerminologyLibrary } from "../sections/terminology/TerminologyLibrary";
import { TemplateLibrary } from "../sections/templates/TemplateLibrary";
import { authClient } from "../lib/auth-client";
import { I18nProvider, useI18n } from "../lib/i18n";
import { ActionIcon, WorkspaceIcon, iconChoices } from "../lib/workspace-icons";
import { VersionHistoryDialog } from "./VersionHistoryDialog";
import { KnowledgeDocumentEditorDialog, type EditableKnowledgeDocument } from "./KnowledgeDocumentEditorDialog";
import { KnowledgeAttachmentLibrary } from "./KnowledgeAttachmentLibrary";
import { KnowledgeMarkdown } from "./KnowledgeMarkdown";
import { PersonalTodo } from "./PersonalTodo";
import { brandScope, describeWorkspaceScopes, isWorkspaceScopeAllowed, productScope } from "../lib/workspace-scopes";

type View = "home" | "docs" | "sop-brands" | "sop-products" | "sop-detail" | "tracker-brands" | "tracker-products" | "tracker-detail" | "other-docs" | "terms" | "templates";
type Role = "admin" | "editor" | "viewer";
type LinkRecord = { id: string; brand: string; product: string; name: string; url: string; cycle: string; platform: string; note: string; color: string; createdAt: string; updatedAt?: string; updatedBy?: string; version?: number; sortOrder?: number };
type CollaboratorRecord = { userId: string; name: string; email: string; permission: "view" | "edit" };
type DocCategoryRecord = { id: string; name: string; parentId: string | null; sortOrder: number };
type SopRecord = { id: string; categoryId?: string; brand: string; product: string; group: string; title: string; content: string; items: string[]; attachments?: AttachmentRecord[]; collaborators?: CollaboratorRecord[]; updatedBy: string; updatedAt: string; version?: number; status?: "draft" | "published" | "archived"; treeIcon?: string; treeIconColor?: string; sortOrder?: number; canEdit?: boolean; canManage?: boolean };
type SopCategoryRecord = { id: string; brand: string; product: string; name: string; parentId: string | null; sortOrder: number };
type AttachmentRecord = { id: string; name: string; type: string; size: number; url: string; version?: number };
type DocRecord = { id: string; categoryId?: string; group: string; title: string; owner: string; updatedAt: string; body: string; items: string[]; attachments?: AttachmentRecord[]; attachment?: AttachmentRecord | null; collaborators?: CollaboratorRecord[]; version?: number; status?: "draft" | "published" | "archived"; treeIcon?: string; treeIconColor?: string; sortOrder?: number; canEdit?: boolean; canManage?: boolean };
type ProductTemplateRecord = { id: string; brand: string; product: string; title: string; summary: string; content: string; attachmentId: string | null; attachmentName: string | null; attachmentSize: number | null; createdBy: string; updatedBy: string; createdAt: string; updatedAt: string };
type UserRecord = { id: string; email: string; name: string; role: Role; scopes: string[]; banned?: boolean };
type SearchResult = { type: "文章" | "附件" | "术语"; title: string; desc: string; view: View; entityId: string; brand?: string; product?: string; url?: string };
type WorkspaceState = { docCategories: string[]; docCategoryRecords?: DocCategoryRecord[]; otherDocCategories: string[]; otherDocCategoryRecords?: DocCategoryRecord[]; brands: string[]; products: string[]; productsByBrand: Record<string, string[]>; brandIds: Record<string, string>; productIds: Record<string, string>; brandIcons: Record<string, string>; productIcons: Record<string, string>; links: LinkRecord[]; sops: SopRecord[]; sopCategories: SopCategoryRecord[]; docs: DocRecord[]; otherDocs: DocRecord[]; users: UserRecord[] };
type StructureDrag = { kind: "category" | "document"; id: string; containerId: string };
type DocumentHeading = { text: string; level: number };
const COPYRIGHT_NOTICE = "Knowledge Workbench contributors.";

function getDocumentHeadings(markdown: string): DocumentHeading[] {
  const headings: DocumentHeading[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!match) continue;
    const text = match[2].replace(/\s+#+\s*$/, "").trim();
    if (text) headings.push({ text, level: match[1].length });
  }
  return headings;
}

function documentHeadingSelector(readerId: string) {
  return `[data-document-reader="${readerId}"] .doc-body :is(h1,h2,h3,h4,h5,h6)`;
}

const modules = [
  { view: "docs" as View, icon: "docs", title: "通用资料与规章制度", desc: "集中查阅公司资料、规章制度与入职指南。" },
  { view: "sop-brands" as View, icon: "sop", title: "品牌 / 产品 SOP", desc: "按品牌与产品线查阅标准作业流程。" },
  { view: "tracker-brands" as View, icon: "tracker", title: "项目跟踪表格索引", desc: "快速访问各项目日、周、月维护表格。" },
  { view: "other-docs" as View, icon: "other", title: "其它资料", desc: "集中查阅与维护其它类型的知识资料。" },
  { view: "terms" as View, icon: "terms", title: "行业术语库", desc: "统一查询业务术语、释义与使用场景。" },
  { view: "templates" as View, icon: "templates", title: "通用附件及模板", desc: "预览、复制与下载常用附件和工作模板。" },
];

const fallback: WorkspaceState = {
  docCategories: ["通用资料", "操作指南"],
  docCategoryRecords: [
    { id: "fallback-doc-category-general", name: "通用资料", parentId: null, sortOrder: 0 },
    { id: "fallback-doc-category-guides", name: "操作指南", parentId: null, sortOrder: 1 },
  ],
  otherDocCategories: ["其它资料"],
  otherDocCategoryRecords: [{ id: "fallback-other-doc-category", name: "其它资料", parentId: null, sortOrder: 0 }],
  brands: [], products: [], productsByBrand: {}, brandIds: {}, productIds: {}, brandIcons: {}, productIcons: {}, users: [],
  links: [],
  sops: [],
  sopCategories: [],
  docs: [],
  otherDocs: [],
};

const cycleLabels: Record<string, string> = { daily: "日维护", weekly: "周维护", monthly: "月维护", other: "其它" };

function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)).replaceAll("/", "/"); }
function initials(name: string) { return name.replace("品牌 ", "").slice(0, 2) || "知"; }
function contrast(color: string) { const value = color.replace("#", ""); const r = parseInt(value.slice(0, 2), 16), g = parseInt(value.slice(2, 4), 16), b = parseInt(value.slice(4, 6), 16); return (r * 299 + g * 587 + b * 114) / 1000 > 155 ? "#12213a" : "#fff"; }
function scopeAllows(profile: UserRecord, data: WorkspaceState, brand: string, product?: string) { return profile.role === "admin" || isWorkspaceScopeAllowed(data, profile.scopes, brand, product); }
function sameOrder(left: string[], right: string[]) { return left.length === right.length && left.every((id, index) => id === right[index]); }
function moveIdRelative(ids: string[], source: string, target: string, after: boolean) {
  const next = ids.filter((id) => id !== source);
  const targetIndex = next.indexOf(target);
  next.splice(targetIndex < 0 ? next.length : targetIndex + (after ? 1 : 0), 0, source);
  return next;
}
function pointerIsAfter(event: ReactDragEvent<HTMLElement>, layout: "vertical" | "grid" = "vertical") {
  const rect = event.currentTarget.getBoundingClientRect();
  if (layout === "vertical") return event.clientY >= rect.top + rect.height / 2;
  const nearSameRow = Math.abs(event.clientY - (rect.top + rect.height / 2)) <= rect.height * 0.35;
  return nearSameRow ? event.clientX >= rect.left + rect.width / 2 : event.clientY >= rect.top + rect.height / 2;
}
function orderByIds<T extends { id: string }>(items: T[], ids: string[]) { if (!ids.length) return items; const positions = new Map(ids.map((id, index) => [id, index])); return items.slice().sort((left, right) => (positions.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(right.id) ?? Number.MAX_SAFE_INTEGER)); }
function applyIdOrder<T extends { id: string; sortOrder?: number }>(items: T[], ids: string[]) {
  const selected = new Set(ids), byId = new Map(items.map((item) => [item.id, item])); let pointer = 0;
  return items.map((item) => selected.has(item.id) ? { ...byId.get(ids[pointer])!, sortOrder: pointer++ } : item);
}

function useNameSort(items: string[], onReorder?: (items: string[]) => Promise<boolean>) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [preview, setPreview] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const draggingRef = useRef<string | null>(null);
  const previewRef = useRef<string[]>([]);
  const dropCommitted = useRef(false);
  const visible = dragging ? preview : items;
  function begin(event: ReactDragEvent<HTMLElement>, value: string) {
    if (busy || !onReorder) return;
    event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", value);
    draggingRef.current = value; previewRef.current = items.slice(); dropCommitted.current = false; setDragging(value); setPreview(items.slice());
  }
  function move(event: ReactDragEvent<HTMLElement>, target: string) {
    const source = draggingRef.current;
    if (!source) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "move";
    if (source === target) return;
    const next = moveIdRelative(previewRef.current, source, target, pointerIsAfter(event, "grid"));
    if (sameOrder(next, previewRef.current)) return;
    previewRef.current = next; setPreview(next);
  }
  async function commit(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault(); event.stopPropagation();
    if (!draggingRef.current || busy || !onReorder) return;
    dropCommitted.current = true; const next = previewRef.current.slice(); setBusy(true); setDragging(null);
    try { await onReorder(next); }
    finally { setBusy(false); draggingRef.current = null; previewRef.current = []; setPreview([]); }
  }
  function cancel() {
    if (dropCommitted.current) { dropCommitted.current = false; return; }
    if (busy) return;
    draggingRef.current = null; previewRef.current = []; setDragging(null); setPreview([]);
  }
  return { visible, dragging, busy, begin, move, commit, cancel };
}

export function WorkspaceApp() {
  const session = authClient.useSession();
  useEffect(() => { console.info(COPYRIGHT_NOTICE); }, []);
  if (session.isPending) return <div className="auth-loading"><span className="brand-mark">工</span><b>正在验证登录状态…</b></div>;
  if (!session.data?.user) return <AuthScreen onAuthenticated={() => window.location.reload()} />;
  return <I18nProvider><WorkspaceCore sessionUser={session.data.user as { id: string; name: string; email: string; role?: string }} /></I18nProvider>;
}

function WorkspaceCore({ sessionUser }: { sessionUser: { id: string; name: string; email: string; role?: string } }) {
  const [data, setData] = useState<WorkspaceState>(fallback);
  const [profile, setProfile] = useState<UserRecord>({ id: sessionUser.id, email: sessionUser.email, name: sessionUser.name, role: (sessionUser.role as Role) || "viewer", scopes: ["*"] });
  const [view, setView] = useState<View>("home");
  const [brand, setBrand] = useState("品牌 A");
  const [product, setProduct] = useState("产品 1");
  const [selectedDoc, setSelectedDoc] = useState("onboarding");
  const [selectedOtherDoc, setSelectedOtherDoc] = useState("");
  const [selectedSopDoc, setSelectedSopDoc] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [noPermission, setNoPermission] = useState(false);
  const [revision, setRevision] = useState(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [todoSettingsOpen, setTodoSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [docsStructureOpen, setDocsStructureOpen] = useState(false);
  const [otherDocsStructureOpen, setOtherDocsStructureOpen] = useState(false);
  const [sopStructureOpen, setSopStructureOpen] = useState(false);
  const noticeTimer = useRef<number | null>(null);
  const dirtyRef = useRef(false);

  // Initial load intentionally runs once; retry is exposed through the error state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const timer = window.setTimeout(() => { void loadWorkspace(); }, 0); const connected = () => setOnline(true), disconnected = () => setOnline(false); window.addEventListener("online", connected); window.addEventListener("offline", disconnected); return () => { window.clearTimeout(timer); window.removeEventListener("online", connected); window.removeEventListener("offline", disconnected); }; }, []);

  useEffect(() => () => { if (noticeTimer.current) window.clearTimeout(noticeTimer.current); }, []);
  useEffect(() => { const dirty = (event: Event) => { dirtyRef.current = Boolean((event as CustomEvent<boolean>).detail); }; const pop = () => { if (dirtyRef.current && !window.confirm("有未保存的修改，确认离开当前页面吗？")) { window.history.forward(); return; } dirtyRef.current = false; applyLocation(data); }; window.addEventListener("workspace-dirty", dirty); window.addEventListener("popstate", pop); return () => { window.removeEventListener("workspace-dirty", dirty); window.removeEventListener("popstate", pop); }; }, [data]);

  function toast(message: string) {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 3200);
  }

  async function loadWorkspace() {
    setLoading(true); setLoadError("");
    try { const response = await fetch("/api/workspace"); const body = await response.json(); if (!response.ok) throw new Error(body.error || "工作台加载失败"); setData(body.state); setProfile(body.profile); setRevision(Number(body.revision || 1)); applyLocation(body.state); }
    catch (error) { setLoadError(error instanceof Error ? error.message : "工作台加载失败"); }
    finally { setLoading(false); }
  }

  function applyLocation(current: WorkspaceState) { const params = new URLSearchParams(window.location.search); const requested = params.get("view") as View | null; const valid: View[] = ["home", "docs", "sop-brands", "sop-products", "sop-detail", "tracker-brands", "tracker-products", "tracker-detail", "other-docs", "terms", "templates"]; const next = requested && valid.includes(requested) ? requested : "home"; const brandId = params.get("brand"), productId = params.get("product"); const visibleBrand = current.brands.find((item) => current.brandIds[item] === brandId); const nextBrand = visibleBrand || current.brands[0] || ""; const visibleProduct = (current.productsByBrand[nextBrand] || []).find((item) => current.productIds[`${nextBrand}/${item}`] === productId); const nextProduct = visibleProduct || current.productsByBrand[nextBrand]?.[0] || ""; setNoPermission(Boolean((brandId && !visibleBrand) || (productId && !visibleProduct))); setView(next); setBrand(nextBrand); setProduct(nextProduct); if (params.get("doc")) { if (next === "sop-detail") setSelectedSopDoc(params.get("doc")!); else if (next === "other-docs") setSelectedOtherDoc(params.get("doc")!); else setSelectedDoc(params.get("doc")!); } }

  function navigate(requestedNext: View, nextBrand?: string, nextProduct?: string, nextDoc?: string) {
    if (dirtyRef.current && !window.confirm("有未保存的修改，确认离开当前页面吗？")) return;
    const next = requestedNext;
    dirtyRef.current = false;
    if (nextBrand) setBrand(nextBrand); if (nextProduct) setProduct(nextProduct);
    if (nextDoc) { if (next === "sop-detail") setSelectedSopDoc(nextDoc); else if (next === "other-docs") setSelectedOtherDoc(nextDoc); else setSelectedDoc(nextDoc); } setView(next); setAccountOpen(false); setDocsStructureOpen(false); setOtherDocsStructureOpen(false); setSopStructureOpen(false);
    const params = new URLSearchParams(); if (next !== "home") params.set("view", next); const targetBrand = nextBrand || brand, targetProduct = nextProduct || product, targetDoc = nextDoc || (next === "sop-detail" ? selectedSopDoc : next === "other-docs" ? selectedOtherDoc : selectedDoc); if (next.startsWith("sop") || next.startsWith("tracker")) { const brandId = data.brandIds[targetBrand]; if (brandId) params.set("brand", brandId); if (next.endsWith("detail")) { const productId = data.productIds[`${targetBrand}/${targetProduct}`]; if (productId) params.set("product", productId); } } if ((next === "docs" || next === "other-docs" || next === "sop-detail") && targetDoc) params.set("doc", targetDoc); const url = params.size ? `${window.location.pathname}?${params}` : window.location.pathname; window.history.pushState({}, "", url); window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectDoc(id: string) { setSelectedDoc(id); const params = new URLSearchParams(window.location.search); params.set("view", "docs"); params.set("doc", id); window.history.pushState({}, "", `${window.location.pathname}?${params}`); }
  function selectOtherDoc(id: string) { setSelectedOtherDoc(id); const params = new URLSearchParams(window.location.search); params.set("view", "other-docs"); params.set("doc", id); window.history.pushState({}, "", `${window.location.pathname}?${params}`); }

  async function persist(next: WorkspaceState, message: string) {
    setData(next);
    try {
      const response = await fetch("/api/workspace", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: next, revision }) });
      const body = await response.json(); if (!response.ok) { if (response.status === 409) { const latest = await fetch("/api/workspace").then((item) => item.json()); setData(latest.state); setRevision(Number(latest.revision || revision)); throw new Error("检测到其他成员刚刚保存了内容，已加载最新版本，请重新操作。"); } throw new Error(body.error || "保存失败"); } setRevision(Number(body.revision || revision + 1)); toast(message);
    } catch (error) { toast(error instanceof Error ? error.message : "保存失败"); }
  }

  async function catalogAction(method: "PUT" | "DELETE", payload: Record<string, unknown>, message: string) {
    try {
      const response = await fetch("/api/catalog", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, revision }) });
      const body = await response.json();
      if (!response.ok) {
        if (body.usage) { const used = Object.entries(body.usage as Record<string, number>).filter(([, count]) => count > 0).map(([key, count]) => `${key}: ${count}`).join("，"); throw new Error(`${body.error}（${used}）`); }
        if (response.status === 409 && body.conflict) { const latest = await fetch("/api/workspace").then((item) => item.json()); setData(latest.state); setRevision(Number(latest.revision || revision)); }
        throw new Error(body.error || "操作失败");
      }
      setData(body.state); setRevision(Number(body.revision || revision + 1)); toast(message); return true;
    } catch (error) { toast(error instanceof Error ? error.message : "操作失败"); return false; }
  }

  async function reorderCatalog(kind: "brands" | "products", names: string[], targetBrand?: string) {
    const previous = data;
    const next = kind === "brands" ? { ...data, brands: names } : { ...data, productsByBrand: { ...data.productsByBrand, [targetBrand!]: names } };
    const ids = kind === "brands" ? names.map((name) => data.brandIds[name]) : names.map((name) => data.productIds[`${targetBrand}/${name}`]);
    let loadedLatest = false; setData(next);
    try {
      const response = await fetch("/api/catalog/order", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, brandId: targetBrand ? data.brandIds[targetBrand] : undefined, ids, revision }) });
      const body = await response.json();
      if (!response.ok) { if (body.conflict) { await loadWorkspace(); loadedLatest = true; } throw new Error(body.error || "目录排序保存失败"); }
      setRevision(Number(body.revision || revision + 1)); toast("目录顺序已保存"); return true;
    } catch (error) { if (!loadedLatest) setData(previous); toast(error instanceof Error ? error.message : "目录排序保存失败"); return false; }
  }

  async function manageKnowledgeCategory(space: "general" | "other", action: "create" | "rename" | "delete", name: string, newName?: string, options?: { categoryId?: string; parentId?: string | null }) {
    try {
      const response = await fetch("/api/docs/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ space: space === "other" ? "other" : undefined, action, name, newName, categoryId: options?.categoryId, parentId: options?.parentId, revision }) });
      const body = await response.json();
      if (!response.ok) {
        if (body.conflict) await loadWorkspace();
        throw new Error(body.error || "分类操作失败");
      }
      setData((current) => {
        const source = space === "other" ? current.otherDocs : current.docs;
        const documents = action === "delete" ? source.filter((doc) => !(body.deletedDocumentIds || []).includes(doc.id)) : action === "rename" ? source.map((doc) => (options?.categoryId ? doc.categoryId === options.categoryId : doc.group === name) ? { ...doc, group: newName || name } : doc) : source;
        return space === "other"
          ? { ...current, otherDocCategories: body.categories, otherDocCategoryRecords: body.categoryRecords, otherDocs: documents }
          : { ...current, docCategories: body.categories, docCategoryRecords: body.categoryRecords, docs: documents };
      });
      setRevision(Number(body.revision || revision + 1));
      toast(`${space === "other" ? "其它资料" : "资料"}分类已${({ create: "创建", rename: "重命名", delete: "删除" } as const)[action]}`);
      return true;
    } catch (error) { toast(error instanceof Error ? error.message : "分类操作失败"); return false; }
  }
  const manageDocCategory = (action: "create" | "rename" | "delete", name: string, newName?: string, options?: { categoryId?: string; parentId?: string | null }) => manageKnowledgeCategory("general", action, name, newName, options);
  const manageOtherDocCategory = (action: "create" | "rename" | "delete", name: string, newName?: string, options?: { categoryId?: string; parentId?: string | null }) => manageKnowledgeCategory("other", action, name, newName, options);

  function scrollToWikiHeading(heading: string) {
    window.setTimeout(() => {
      const normalized = heading.trim().toLocaleLowerCase();
      const match = [...document.querySelectorAll<HTMLElement>(".doc-body h1, .doc-body h2, .doc-body h3, .doc-body h4, .doc-body h5, .doc-body h6")]
        .find((item) => item.textContent?.trim().toLocaleLowerCase() === normalized);
      match?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  function openWikiTarget(rawTarget: string) {
    const [rawDocument, rawHeading = ""] = rawTarget.split("#", 2);
    const documentName = rawDocument.replace(/\.md$/i, "").replaceAll("\\", "/").split("/").pop()?.trim() || "";
    if (!documentName && rawHeading) return scrollToWikiHeading(rawHeading);
    const normalized = documentName.toLocaleLowerCase();
    const candidates = [
      ...data.docs.map((record) => ({ record, view: "docs" as View })),
      ...data.otherDocs.map((record) => ({ record, view: "other-docs" as View })),
      ...data.sops.map((record) => ({ record, view: "sop-detail" as View })),
    ];
    const exact = candidates.find(({ record }) => record.title.trim().toLocaleLowerCase() === normalized);
    const partial = candidates.filter(({ record }) => record.title.trim().toLocaleLowerCase().includes(normalized));
    const target = exact || (partial.length === 1 ? partial[0] : undefined);
    if (!target) { setQuery(documentName); setSearchOpen(true); return toast(`未找到唯一匹配的知识文章：${documentName}`); }
    if (target.view === "sop-detail") {
      const record = target.record as SopRecord;
      navigate("sop-detail", record.brand, record.product, record.id);
    } else navigate(target.view, undefined, undefined, target.record.id);
    if (rawHeading) scrollToWikiHeading(rawHeading);
  }

  useEffect(() => {
    const handler = (event: Event) => openWikiTarget(String((event as CustomEvent<string>).detail || ""));
    window.addEventListener("workspace-wiki-link", handler);
    return () => window.removeEventListener("workspace-wiki-link", handler);
  });

  const canEdit = profile.role !== "viewer";
  const titleMap: Partial<Record<View, string>> = { docs: "通用资料与规章制度", "sop-brands": "品牌 / 产品 SOP", "sop-products": "品牌 / 产品 SOP", "sop-detail": `${brand} · ${product} SOP`, "tracker-brands": "项目跟踪表格索引", "tracker-products": "项目跟踪表格索引", "tracker-detail": `${brand} · ${product}`, "other-docs": "其它资料", terms: "行业术语库", templates: "通用附件及模板" };

  return (
    <main className="workspace-app">
      <Header profile={profile} showSearch={view !== "home"} onHome={() => navigate("home")} onSearch={() => setSearchOpen(true)} onAdmin={() => setPermissionsOpen(true)} onProfile={() => { setProfileOpen(true); setAccountOpen(false); }} onTodo={() => { setTodoSettingsOpen(true); setAccountOpen(false); }} onSignOut={async () => { await authClient.signOut(); window.location.reload(); }} accountOpen={accountOpen} setAccountOpen={setAccountOpen} />
      {loading && <div className="loading-line" />}
      {!online && <div className="connection-banner" role="status">网络连接已断开。未保存内容仍保留在当前设备，恢复连接后请重试保存。</div>}
      {loadError ? <div className="page-shell state-page"><ActionIcon name="refresh" size={26} /><h1>工作台加载失败</h1><p>{loadError}</p><button className="primary" onClick={loadWorkspace}>重新加载</button></div> : noPermission ? <div className="page-shell state-page"><ActionIcon name="admin" size={26} /><h1>无权限访问</h1><p>当前账号没有访问该品牌或产品线的权限。</p><button className="primary" onClick={() => { setNoPermission(false); navigate("home"); }}>返回工作台</button></div> : view === "home" ? <Home onNavigate={navigate} onSearch={() => setSearchOpen(true)} /> : (
        <div className="page-shell">
          <Breadcrumb view={view} brand={brand} product={product} title={titleMap[view] || ""} navigate={navigate} actions={view === "docs" && profile.role !== "viewer" ? <button className="primary breadcrumb-action" onClick={() => setDocsStructureOpen(true)}><ActionIcon name="edit" />编辑层级</button> : view === "other-docs" && profile.role !== "viewer" ? <button className="primary breadcrumb-action" onClick={() => setOtherDocsStructureOpen(true)}><ActionIcon name="edit" />编辑层级</button> : view === "sop-detail" && canEdit && scopeAllows(profile, data, brand, product) ? <button className="primary breadcrumb-action" onClick={() => setSopStructureOpen(true)}><ActionIcon name="edit" />编辑层级</button> : null} />
          {view === "docs" && <DocsPage data={data} selected={selectedDoc} onSelect={selectDoc} canEdit={profile.role !== "viewer"} canManageStructure={profile.role === "admin"} structureOpen={docsStructureOpen} onCloseStructure={() => setDocsStructureOpen(false)} setData={setData} onCategoryAction={manageDocCategory} toast={toast} />}
          {view === "sop-brands" && <BrandPicker title="品牌 / 产品 SOP" description="先选择品牌，再进入对应产品线的 SOP。" brands={data.brands} icons={data.brandIcons} canSort={profile.role !== "viewer"} onReorder={(names) => reorderCatalog("brands", names)} onPick={(value) => navigate("sop-products", value)} />}
          {view === "sop-products" && <ProductPicker title="品牌 / 产品 SOP" brand={brand} products={data.productsByBrand[brand] || data.products} icons={data.productIcons} canSort={profile.role !== "viewer" && scopeAllows(profile, data, brand)} onReorder={(names) => reorderCatalog("products", names, brand)} onPick={(value) => navigate("sop-detail", brand, value)} />}
          {view === "sop-detail" && <SopPage key={data.productIds[`${brand}/${product}`]} data={data} brand={brand} product={product} selected={selectedSopDoc} canEdit={canEdit && scopeAllows(profile, data, brand, product)} canManageCollaborators={profile.role === "admin"} structureOpen={sopStructureOpen} onCloseStructure={() => setSopStructureOpen(false)} setData={setData} onSelect={(nextDoc) => navigate("sop-detail", brand, product, nextDoc)} toast={toast} />}
          {view === "tracker-brands" && <BrandPicker title="项目跟踪表格索引" description="按品牌与产品线集中管理项目跟踪入口。" brands={data.brands} icons={data.brandIcons} canSort={profile.role !== "viewer"} onReorder={(names) => reorderCatalog("brands", names)} onPick={(value) => navigate("tracker-products", value)} />}
          {view === "tracker-products" && <ProductPicker title="项目跟踪表格索引" brand={brand} products={data.productsByBrand[brand] || data.products} icons={data.productIcons} canSort={profile.role !== "viewer" && scopeAllows(profile, data, brand)} onReorder={(names) => reorderCatalog("products", names, brand)} onPick={(value) => navigate("tracker-detail", brand, value)} />}
          {view === "tracker-detail" && <TrackerPage data={data} brand={brand} product={product} canEdit={canEdit && scopeAllows(profile, data, brand, product)} setData={setData} toast={toast} />}
          {view === "other-docs" && <DocsPage kind="other" data={data} selected={selectedOtherDoc} onSelect={selectOtherDoc} canEdit={profile.role !== "viewer"} canManageStructure={profile.role === "admin"} structureOpen={otherDocsStructureOpen} onCloseStructure={() => setOtherDocsStructureOpen(false)} setData={setData} onCategoryAction={manageOtherDocCategory} toast={toast} />}
          {view === "terms" && <div className="vault-module"><TerminologyLibrary canEdit={canEdit} /></div>}
          {view === "templates" && <div className="vault-module"><TemplateLibrary canEdit={canEdit} /></div>}
        </div>
      )}
      {notice && <div className="toast" role="status"><ActionIcon name="check" />{notice}</div>}
      {searchOpen && <SearchDialog query={query} setQuery={setQuery} onClose={() => setSearchOpen(false)} onOpen={(result) => { setSearchOpen(false); if (result.url) { window.open(result.url, "_blank", "noopener,noreferrer"); return; } navigate(result.view, result.brand, result.product, result.view === "docs" || result.view === "other-docs" || result.view === "sop-detail" ? result.entityId : undefined); }} />}
      {permissionsOpen && <AdminConsole profile={profile} data={data} persist={persist} reorderCatalog={reorderCatalog} catalogAction={catalogAction} toast={toast} onClose={() => setPermissionsOpen(false)} />}
      {profileOpen && <PersonalSettings profile={profile} onSaved={(name) => setProfile((current) => ({ ...current, name }))} onClose={() => setProfileOpen(false)} />}
      <PersonalTodo showWidget={view === "home"} settingsOpen={todoSettingsOpen} isAdmin={profile.role === "admin"} onCloseSettings={() => setTodoSettingsOpen(false)} toast={toast} />
    </main>
  );
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [needsSetup, setNeedsSetup] = useState(false); const [checking, setChecking] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { fetch("/api/auth-bootstrap").then((response) => response.json()).then((body) => setNeedsSetup(Boolean(body.needsSetup))).catch(() => setError("无法连接本地账号数据库。" )).finally(() => setChecking(false)); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget); const username = String(form.get("username") || ""), password = String(form.get("password") || "");
    try {
      if (needsSetup) {
        const response = await fetch("/api/auth-bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, name: String(form.get("name") || username) }) });
        const body = await response.json(); if (!response.ok) throw new Error(body.error || "初始化失败"); setNeedsSetup(false);
      }
      const result = await authClient.signIn.username({ username, password, rememberMe: form.get("rememberMe") === "on" }); if (result.error) throw new Error(result.error.message || "账号或密码错误"); onAuthenticated();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "登录失败"); } finally { setBusy(false); }
  }
  function submitOnEnter(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || busy || checking) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }
  return <main className="auth-page"><section className="auth-brand"><div className="auth-brand-inner"><span className="auth-logo">知</span><p className="eyebrow">KNOWLEDGE WORKSPACE</p><h1>让团队的知识，<br /><em>真正流动起来。</em></h1><p>资料、SOP、项目跟踪、术语与模板，集中在一个清晰、安全、可维护的工作空间。</p><div className="auth-feature-grid"><div><span><WorkspaceIcon name="docs" /></span><b>统一知识入口</b><small>六大模块集中检索</small></div><div><span><ActionIcon name="admin" /></span><b>精细权限控制</b><small>品牌 × 产品线授权</small></div><div><span><ActionIcon name="check" /></span><b>本地自主部署</b><small>数据由部署者掌控</small></div></div><footer>请妥善保管账号与访问地址</footer></div></section><section className="auth-panel"><form onSubmit={submit}><header><span className="mobile-auth-logo">知</span><p>{needsSetup ? "FIRST RUN SETUP" : "WELCOME BACK"}</p><h2>{needsSetup ? "初始化管理员账号" : "登录工作空间"}</h2><small>{needsSetup ? "创建第一个管理员，完成后即可进入工作台。" : "使用管理员分配的账号密码登录。"}</small></header>{error && <div className="auth-error">! {error}</div>}{needsSetup && <label>显示名称<input name="name" required placeholder="例如：知识管理员" autoComplete="name" /></label>}<label>账号<input name="username" required minLength={3} maxLength={30} placeholder="请输入账号" autoComplete="username" onKeyDown={submitOnEnter} /></label><label>密码<input name="password" required minLength={8} type="password" placeholder="请输入密码" autoComplete={needsSetup ? "new-password" : "current-password"} onKeyDown={submitOnEnter} /></label><div className="auth-options"><label><input name="rememberMe" type="checkbox" /> 记住登录状态</label>{!needsSetup && <small>忘记密码请联系管理员</small>}</div><button className="auth-submit" type="submit" disabled={busy || checking}>{checking ? "正在检查…" : busy ? "正在处理…" : needsSetup ? "创建并进入工作台" : "登录"}<ActionIcon name="next" /></button><p className="auth-security"><ActionIcon name="admin" size={14} />密码经 Better Auth 的安全哈希处理，不以明文保存</p></form></section></main>;
}

function Header({ profile, showSearch, onHome, onSearch, onAdmin, onProfile, onTodo, onSignOut, accountOpen, setAccountOpen }: { profile: UserRecord; showSearch: boolean; onHome: () => void; onSearch: () => void; onAdmin: () => void; onProfile: () => void; onTodo: () => void; onSignOut: () => void; accountOpen: boolean; setAccountOpen: (value: boolean) => void }) {
  const { locale, setLocale, t } = useI18n();
  return <header className="topbar">
    <button className="brand" onClick={onHome}><span className="brand-mark">工</span><strong>{t("workspace")}</strong></button>
    <nav className="top-actions" aria-label="全局操作">
      {showSearch && <button className="compact-search" onClick={onSearch}><ActionIcon name="search" /><span>{t("search")}</span></button>}
      <button className="language-toggle" onClick={() => setLocale(locale === "zh" ? "en" : "zh")}><ActionIcon name="language" /><span>{t("systemLanguage")}</span></button>
      <div className="account-wrap"><button className="user-pill" onClick={() => setAccountOpen(!accountOpen)}><span>{initials(profile.name)}</span><b className="user-name">{profile.name}</b><ActionIcon name="expand" size={14} /></button>
        {accountOpen && <div className="account-menu"><div><b>{profile.name}</b><small>{profile.email}</small></div>{profile.role === "admin" && <button onClick={onAdmin}><ActionIcon name="admin" />{t("admin")}</button>}<button onClick={onProfile}><ActionIcon name="settings" />{t("settings")}</button><button onClick={onTodo}><ActionIcon name="check" />TODO 设置</button><button onClick={onSignOut}><ActionIcon name="signOut" />{t("signOut")}</button></div>}
      </div>
    </nav>
  </header>;
}

function Home({ onNavigate, onSearch }: { onNavigate: (view: View) => void; onSearch: () => void }) {
  const { locale, t } = useI18n(); const localized: Record<string, string> = { docs: t("docs"), "sop-brands": t("sop"), "tracker-brands": t("tracker"), "other-docs": t("otherDocs"), terms: t("terms"), templates: t("templates") };
  return <section className="home-shell">
    <div className="hero-copy"><p className="eyebrow">KNOWLEDGE WORKSPACE</p><h1>{t("workspace")}</h1><p>{locale === "zh" ? "公司知识与业务工具的统一入口，集中承载资料、SOP、项目跟踪、术语与模板。" : "One place for company knowledge, SOPs, trackers, terminology and reusable templates."}</p>
      <button className="search" onClick={onSearch}><span><ActionIcon name="search" size={20} /></span><em>{locale === "zh" ? "搜索资料、SOP、术语或模板…" : "Search documents, SOPs, terms or templates…"}</em></button>
    </div>
    <div className="module-grid">{modules.map((item, index) => <button className={`module-card module-${index + 1}`} onClick={() => onNavigate(item.view)} key={item.title}><span className="module-icon"><WorkspaceIcon name={item.icon} size={25} /></span><h2>{localized[item.view] || item.title}</h2><p>{locale === "zh" ? item.desc : "Open this workspace module to browse and manage its content."}</p><b>{t("enter")}<ActionIcon name="next" size={20} /></b></button>)}</div>
  </section>;
}

function Breadcrumb({ view, brand, product, title, navigate, actions }: { view: View; brand: string; product: string; title: string; navigate: (view: View, brand?: string, product?: string) => void; actions?: ReactNode }) {
  const { t } = useI18n();
  const sop = view.startsWith("sop"); const tracker = view.startsWith("tracker");
  const parent = sop ? "sop-brands" : tracker ? "tracker-brands" : "home";
  const back = view.endsWith("detail") ? (sop ? "sop-products" : "tracker-products") : view.endsWith("products") ? parent : "home";
  return <div className="breadcrumb-row"><button className="back-button" onClick={() => navigate(back as View, back.endsWith("products") ? brand : undefined)}><ActionIcon name="back" size={14} />{t("back")}</button><div className="breadcrumbs"><button onClick={() => navigate("home")}>{t("workspace")}</button><ActionIcon name="next" size={12} /><button onClick={() => navigate(parent as View)}>{sop ? t("sop") : tracker ? t("tracker") : title}</button>{(view.endsWith("products") || view.endsWith("detail")) && <><ActionIcon name="next" size={12} /><button onClick={() => navigate(sop ? "sop-products" : "tracker-products", brand)}>{brand}</button></>}{view.endsWith("detail") && <><ActionIcon name="next" size={12} /><b>{product}</b></>}</div>{actions && <div className="breadcrumb-actions">{actions}</div>}</div>;
}

function BrandPicker({ title, description, brands, icons, canSort, onReorder, onPick }: { title: string; description: string; brands: string[]; icons: Record<string, string>; canSort: boolean; onReorder: (brands: string[]) => Promise<boolean>; onPick: (brand: string) => void }) {
  const { t } = useI18n(); const sort = useNameSort(brands, canSort ? onReorder : undefined);
  return <section className="picker-page"><h1>{title}</h1><p>{description}</p><h3>{t("selectBrand")}{canSort && <small className="picker-sort-tip">{sort.busy ? "正在保存顺序…" : "拖拽手柄调整品牌顺序"}</small>}</h3><div className="brand-grid">{sort.visible.map((value) => <button className={sort.dragging === value ? "sorting-drag" : ""} onDragOver={(event) => sort.move(event, value)} onDrop={(event) => void sort.commit(event)} onClick={() => { if (!sort.dragging) onPick(value); }} key={value}><span><WorkspaceIcon name={icons[value]} size={96} /></span><b>{value}</b><em>{t("openProducts")}<ActionIcon name="next" size={16} /></em>{canSort && <i className="picker-sort-handle" draggable={!sort.busy} title="拖拽调整品牌顺序" onDragStart={(event) => sort.begin(event, value)} onDragEnd={sort.cancel}><ActionIcon name="drag" /></i>}</button>)}</div></section>;
}

function ProductPicker({ title, brand, products, icons, canSort, onReorder, onPick }: { title: string; brand: string; products: string[]; icons: Record<string, string>; canSort: boolean; onReorder: (products: string[]) => Promise<boolean>; onPick: (product: string) => void }) {
  const { t } = useI18n(); const sort = useNameSort(products, canSort ? onReorder : undefined);
  return <section className="picker-page"><h1>{title}</h1><p>{t("currentBrand")}：<b>{brand}</b></p><h3>{t("selectProduct")}{canSort && <small className="picker-sort-tip">{sort.busy ? "正在保存顺序…" : "拖拽手柄调整产品顺序"}</small>}</h3><div className="product-grid">{sort.visible.map((value) => <button className={sort.dragging === value ? "sorting-drag" : ""} onDragOver={(event) => sort.move(event, value)} onDrop={(event) => void sort.commit(event)} onClick={() => { if (!sort.dragging) onPick(value); }} key={value}><span><WorkspaceIcon name={icons[`${brand}/${value}`]} size={72} /></span><b>{value}</b><em><ActionIcon name="next" /></em>{canSort && <i className="picker-sort-handle" draggable={!sort.busy} title="拖拽调整产品顺序" onDragStart={(event) => sort.begin(event, value)} onDragEnd={sort.cancel}><ActionIcon name="drag" /></i>}</button>)}</div></section>;
}

function getDocAttachments(doc: DocRecord | null | undefined) { return doc?.attachments?.length ? doc.attachments : doc?.attachment ? [doc.attachment] : []; }

function DocumentReader({ readerId, label, title, owner, updatedAt, status = "published", body, headings, activeHeading, attachments = [], titleAction, afterBody }: { readerId: string; label: string; title: string; owner: string; updatedAt: string; status?: "draft" | "published" | "archived"; body: string; headings: DocumentHeading[]; activeHeading: number; attachments?: AttachmentRecord[]; titleAction?: ReactNode; afterBody?: ReactNode }) {
  const scrollToOverview = () => document.querySelector<HTMLElement>(`[data-document-reader="${readerId}"] .doc-content`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const scrollToHeading = (index: number) => document.querySelectorAll<HTMLElement>(documentHeadingSelector(readerId))[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  function focusReferencedAsset(event: ReactMouseEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a"); if (!link) return;
    const href = link.getAttribute("href") || "";
    const id = href.startsWith("#knowledge-asset-") ? href.slice("#knowledge-asset-".length) : href.match(/\/api\/workspace-attachments\/([^/?#]+)/)?.[1];
    if (!id) return; const target = document.getElementById(`knowledge-asset-${decodeURIComponent(id)}`); if (!target) return;
    event.preventDefault(); target.scrollIntoView({ behavior: "smooth", block: "center" }); target.classList.remove("asset-reference-highlight"); void target.offsetWidth; target.classList.add("asset-reference-highlight");
    window.setTimeout(() => target.classList.remove("asset-reference-highlight"), 2200);
  }
  // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- delegated handling preserves normal keyboard activation on the rendered links.
  return <div className="ionic-doc-reading document-reader" data-document-reader={readerId}><article className="doc-content"><header><div><span>{label}</span><div className="doc-title-row"><h1>{title}</h1>{titleAction}</div></div></header><p className="meta">更新人：{owner}<i />更新时间：{formatTime(updatedAt)}<i />状态：<b className={`document-status ${status}`}>{({ draft: "草稿", published: "已发布", archived: "已归档" } as const)[status]}</b></p><div className="doc-body ionic-doc-theme" onClick={focusReferencedAsset}><KnowledgeMarkdown markdown={body} attachments={attachments} /></div>{afterBody}</article><aside className="ionic-page-toc" aria-label="本文目录"><b>本文内容</b><button className={activeHeading === 0 ? "active" : ""} onClick={scrollToOverview}>概览</button>{headings.map((heading, index) => <button className={`toc-heading toc-level-${heading.level}${activeHeading === index + 1 ? " active" : ""}`} onClick={() => scrollToHeading(index)} key={`${heading.text}-${index}`}>{heading.text}</button>)}</aside></div>;
}

function DocsPage({ kind = "general", data, selected, onSelect, canEdit, canManageStructure, structureOpen, onCloseStructure, setData, onCategoryAction, toast }: { kind?: "general" | "other"; data: WorkspaceState; selected: string; onSelect: (id: string) => void; canEdit: boolean; canManageStructure: boolean; structureOpen: boolean; onCloseStructure: () => void; setData: (next: WorkspaceState) => void; onCategoryAction: (action: "create" | "rename" | "delete", name: string, newName?: string, options?: { categoryId?: string; parentId?: string | null }) => Promise<boolean>; toast: (message: string) => void }) {
  const other = kind === "other";
  const documents = other ? data.otherDocs : data.docs;
  const sourceCategories = other ? data.otherDocCategories : data.docCategories;
  const sourceCategoryRecords = other ? data.otherDocCategoryRecords : data.docCategoryRecords;
  const endpointSuffix = other ? "?space=other" : "";
  const itemEndpoint = (id: string) => `/api/docs/${id}${endpointSuffix}`;
  const readerId = other ? "other-docs-reader" : "docs-reader";
  const legacyGroups = [...new Set([...(sourceCategories || []), ...documents.map((item) => item.group)])];
  const categoryRecords = (sourceCategoryRecords?.length ? sourceCategoryRecords : legacyGroups.map((name, index) => ({ id: `legacy-${kind}-${index}`, name, parentId: null, sortOrder: index }))).slice().sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-CN"));
  const [structureDrag, setStructureDrag] = useState<StructureDrag | null>(null);
  const [structurePreview, setStructurePreview] = useState<string[]>([]);
  const structureDragRef = useRef<StructureDrag | null>(null);
  const structurePreviewRef = useRef<string[]>([]);
  const structureDropCommitted = useRef(false);
  const categoryNames = categoryRecords.map((item) => item.name);
  const topCategories = orderByIds(categoryRecords.filter((item) => !item.parentId), structureDrag?.kind === "category" && structureDrag.containerId === "root" ? structurePreview : []);
  const doc = documents.find((item) => item.id === selected) || documents[0] || null;
  const documentCanEdit = Boolean(doc && (doc.canEdit || (canEdit && !(doc.collaborators?.length))));
  const [editing, setEditing] = useState<DocRecord | "new" | null>(null);
  const [newDocumentCategory, setNewDocumentCategory] = useState(categoryNames[0] || (other ? "其它资料" : "通用资料"));
  const [historyDocument, setHistoryDocument] = useState<DocRecord | null>(null);
  const [structureBusy, setStructureBusy] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(() => new Set());
  const [activeDocHeading, setActiveDocHeading] = useState(0);

  useEffect(() => {
    const selector = documentHeadingSelector(readerId);
    const content = document.querySelector<HTMLElement>(`[data-document-reader="${readerId}"] .doc-body`);
    const headings = [...document.querySelectorAll<HTMLElement>(selector)];
    let offsets: number[] = [], frame = 0, needsMeasure = true;
    const update = () => {
      frame = 0;
      if (needsMeasure) {
        offsets = headings.map((heading) => heading.getBoundingClientRect().top + window.scrollY);
        needsMeasure = false;
      }
      const marker = window.scrollY + 150;
      let low = 0, high = offsets.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (offsets[middle] <= marker) low = middle + 1;
        else high = middle;
      }
      setActiveDocHeading((current) => current === low ? current : low);
    };
    const schedule = (measure = false) => {
      needsMeasure ||= measure;
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const onScroll = () => schedule();
    const onResize = () => schedule(true);
    const resizeObserver = typeof ResizeObserver === "undefined" || !content ? null : new ResizeObserver(onResize);
    if (content) resizeObserver?.observe(content);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    schedule(true);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [doc?.id, doc?.body, readerId]);

  const documentsIn = (category: DocCategoryRecord) => orderByIds(documents.filter((item) => item.categoryId ? item.categoryId === category.id : item.group === category.name), structureDrag?.kind === "document" && structureDrag.containerId === category.id ? structurePreview : []);
  const childrenOf = (category: DocCategoryRecord) => orderByIds(categoryRecords.filter((item) => item.parentId === category.id), structureDrag?.kind === "category" && structureDrag.containerId === category.id ? structurePreview : []);
  function toggleCategory(id: string) { setCollapsedCategories((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function beginStructureDrag(kindValue: StructureDrag["kind"], id: string, containerId: string, ids: string[]) {
    if (structureBusy) return;
    const nextDrag = { kind: kindValue, id, containerId }; structureDragRef.current = nextDrag; structurePreviewRef.current = ids.slice(); structureDropCommitted.current = false; setStructureDrag(nextDrag); setStructurePreview(ids.slice());
  }
  function previewStructureMove(event: ReactDragEvent<HTMLElement>, kindValue: StructureDrag["kind"], targetId: string, containerId: string) {
    const currentDrag = structureDragRef.current;
    if (!currentDrag || currentDrag.kind !== kindValue || currentDrag.containerId !== containerId) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move";
    if (currentDrag.id === targetId) return;
    const next = moveIdRelative(structurePreviewRef.current, currentDrag.id, targetId, pointerIsAfter(event));
    if (sameOrder(next, structurePreviewRef.current)) return;
    structurePreviewRef.current = next; setStructurePreview(next);
  }
  function cancelStructureDrag() {
    if (structureDropCommitted.current) { structureDropCommitted.current = false; return; }
    if (!structureBusy) { structureDragRef.current = null; structurePreviewRef.current = []; setStructureDrag(null); setStructurePreview([]); }
  }
  async function commitStructureOrder(kindValue: StructureDrag["kind"], containerId: string) {
    const currentDrag = structureDragRef.current;
    if (!currentDrag || currentDrag.kind !== kindValue || currentDrag.containerId !== containerId || !structurePreviewRef.current.length) return cancelStructureDrag();
    structureDropCommitted.current = true; const ids = structurePreviewRef.current.slice(), previous = data;
    const next = kindValue === "category"
      ? other ? { ...data, otherDocCategoryRecords: applyIdOrder(data.otherDocCategoryRecords || [], ids) } : { ...data, docCategoryRecords: applyIdOrder(data.docCategoryRecords || [], ids) }
      : other ? { ...data, otherDocs: applyIdOrder(data.otherDocs, ids) } : { ...data, docs: applyIdOrder(data.docs, ids) };
    setData(next); structureDragRef.current = null; structurePreviewRef.current = []; setStructureDrag(null); setStructurePreview([]); setStructureBusy(true);
    try {
      const response = await fetch("/api/knowledge-documents/order", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: other ? "other" : "general", entity: kindValue === "category" ? "categories" : "documents", parentId: kindValue === "category" && containerId !== "root" ? containerId : null, categoryId: kindValue === "document" ? containerId : undefined, ids }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "排序保存失败"); toast("资料顺序已保存");
    } catch (error) { setData(previous); toast(error instanceof Error ? error.message : "排序保存失败"); }
    finally { setStructureBusy(false); }
  }

  async function saveKnowledgeDocument(payload: { title: string; group: string; body: string; items: string[]; attachments: string[]; collaborators: Array<{ userId: string; permission: "view" | "edit" }>; status: "draft" | "published" | "archived"; treeIcon: string; treeIconColor: string; version: number }) {
    try {
      const current = editing === "new" ? null : editing;
      const response = await fetch(current ? itemEndpoint(current.id) : `/api/docs${endpointSuffix}`, { method: current ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "资料保存失败");
      const next = body.doc as DocRecord;
      const nextDocuments = current ? documents.map((item) => item.id === current.id ? { ...next, canEdit: true, canManage: canManageStructure } : item) : [...documents, { ...next, canEdit: true, canManage: canManageStructure }];
      setData(other ? { ...data, otherDocs: nextDocuments } : { ...data, docs: nextDocuments });
      onSelect(next.id); toast(current ? "文章已更新" : "文件已创建"); return next;
    } catch (error) { toast(error instanceof Error ? error.message : "资料保存失败"); return null; }
  }

  async function ensureKnowledgeDocument(payload: Parameters<typeof saveKnowledgeDocument>[0]): Promise<EditableKnowledgeDocument | null> {
    if (editing !== "new") return editableDoc;
    try {
      const response = await fetch(`/api/docs${endpointSuffix}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, status: "draft" }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "草稿创建失败");
      const next = { ...(body.doc as DocRecord), canEdit: true, canManage: canManageStructure };
      const nextDocuments = [...documents, next]; setData(other ? { ...data, otherDocs: nextDocuments } : { ...data, docs: nextDocuments });
      setEditing(next); onSelect(next.id); toast("已自动创建草稿，可继续上传并编辑附件");
      return { id: next.id, title: next.title, group: next.group, body: next.body, items: next.items, attachments: getDocAttachments(next), collaborators: next.collaborators, version: next.version, status: next.status, treeIcon: next.treeIcon, treeIconColor: next.treeIconColor };
    } catch (error) { toast(error instanceof Error ? error.message : "草稿创建失败"); return null; }
  }

  async function createCategory(parent?: DocCategoryRecord) {
    const name = window.prompt(parent ? `在“${parent.name}”下创建二级分类` : "创建一级分类")?.trim(); if (!name) return;
    setStructureBusy(true); await onCategoryAction("create", name, undefined, { parentId: parent?.id || null }); setStructureBusy(false);
  }
  async function renameCategory(category: DocCategoryRecord) {
    const name = window.prompt("输入新的分类名称", category.name)?.trim(); if (!name || name === category.name) return;
    setStructureBusy(true); await onCategoryAction("rename", category.name, name, { categoryId: category.id }); setStructureBusy(false);
  }
  async function deleteCategory(category: DocCategoryRecord) {
    const children = childrenOf(category), affected = [category, ...children], fileCount = affected.reduce((sum, item) => sum + documentsIn(item).length, 0);
    const detail = `${children.length ? `同时删除 ${children.length} 个二级分类；` : ""}${fileCount ? `${fileCount} 个文件将移入回收站，可由管理员恢复。` : "分类中没有文件。"}`;
    if (!window.confirm(`确认删除分类“${category.name}”吗？${detail}`)) return;
    setStructureBusy(true); await onCategoryAction("delete", category.name, undefined, { categoryId: category.id }); setStructureBusy(false);
  }
  function createDocument(category: DocCategoryRecord) { setNewDocumentCategory(category.name); setEditing("new"); }
  async function renameDocument(item: DocRecord) {
    const title = window.prompt("输入新的文件名称", item.title)?.trim(); if (!title || title === item.title) return;
    setStructureBusy(true);
    const response = await fetch(itemEndpoint(item.id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, group: item.group, body: item.body, items: item.items, attachments: getDocAttachments(item).map((attachment) => attachment.id), collaborators: (item.collaborators || []).map((entry) => ({ userId: entry.userId, permission: entry.permission })), status: item.status || "published", treeIcon: item.treeIcon, treeIconColor: item.treeIconColor, version: item.version || 0 }) });
    const body = await response.json(); setStructureBusy(false); if (!response.ok) return toast(body.error || "文件重命名失败");
    const nextDocuments = documents.map((docItem) => docItem.id === item.id ? { ...body.doc, canEdit: true, canManage: canManageStructure } : docItem);
    setData(other ? { ...data, otherDocs: nextDocuments } : { ...data, docs: nextDocuments }); toast("文件已重命名");
  }
  async function deleteDocument(item: DocRecord) {
    if (!window.confirm(`确认删除文件“${item.title}”吗？删除后可由管理员从回收站恢复。`)) return;
    setStructureBusy(true); const response = await fetch(itemEndpoint(item.id), { method: "DELETE" }); const body = await response.json(); setStructureBusy(false); if (!response.ok) return toast(body.error || "文件删除失败");
    const nextDocuments = documents.filter((docItem) => docItem.id !== item.id); setData(other ? { ...data, otherDocs: nextDocuments } : { ...data, docs: nextDocuments }); if (selected === item.id) onSelect(nextDocuments[0]?.id || ""); toast("文件已移入回收站");
  }

  function navigationCategory(category: DocCategoryRecord, level = 0): ReactNode {
    const categoryDocs = documentsIn(category), children = childrenOf(category), collapsed = collapsedCategories.has(category.id), total = categoryDocs.length + children.reduce((sum, child) => sum + documentsIn(child).length, 0);
    return <div className={`doc-group doc-group-level-${level} ${collapsed ? "collapsed" : ""}`} key={category.id}><button className="doc-group-toggle" aria-expanded={!collapsed} onClick={() => toggleCategory(category.id)}><ActionIcon name="folder" size={13} /><span>{category.name}</span><small>{total}</small><ActionIcon name="expand" size={14} /></button>{!collapsed && <>{categoryDocs.map((item) => <button className={item.id === doc?.id ? "active" : ""} onClick={() => onSelect(item.id)} key={item.id}><i className="document-tree-icon" style={{ color: item.treeIconColor || "#53617b" }}><WorkspaceIcon name={item.treeIcon || "docs"} size={14} /></i><span>{item.title}</span>{item.status && item.status !== "published" && <em className={`nav-status ${item.status}`}>{item.status === "draft" ? "草稿" : "归档"}</em>}</button>)}{children.map((child) => navigationCategory(child, 1))}{!categoryDocs.length && !children.length && <small className="doc-group-empty">暂无文件</small>}</>}</div>;
  }
  function structureCategory(category: DocCategoryRecord, level = 0): ReactNode {
    const categoryDocs = documentsIn(category), children = childrenOf(category);
    const categoryContainer = category.parentId || "root";
    return <section className={`structure-category structure-level-${level} ${structureDrag?.id === category.id ? "sorting-drag" : ""} ${structureDrag?.kind === "category" && structureDrag.containerId === categoryContainer && structureDrag.id !== category.id ? "structure-sort-target" : ""}`} onDragOver={(event) => previewStructureMove(event, "category", category.id, categoryContainer)} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void commitStructureOrder("category", categoryContainer); }} key={category.id}><header><div><span className="structure-sort-handle" draggable={!structureBusy} title="拖拽调整文件夹顺序" onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", category.id); beginStructureDrag("category", category.id, categoryContainer, categoryRecords.filter((item) => item.parentId === category.parentId).map((item) => item.id)); }} onDragEnd={cancelStructureDrag}><ActionIcon name="drag" /></span><ActionIcon name="folder" /><span><b>{category.name}</b><small>{level ? "二级分类" : "一级分类"} · {categoryDocs.length} 个文件</small></span></div><nav><button disabled={structureBusy} onClick={() => createDocument(category)}><ActionIcon name="add" />新建文件</button>{canManageStructure && <>{level === 0 && <button disabled={structureBusy} onClick={() => void createCategory(category)}><ActionIcon name="folder" />新建二级分类</button>}<button disabled={structureBusy} onClick={() => void renameCategory(category)}><ActionIcon name="edit" />重命名</button><button className="danger-action" disabled={structureBusy} onClick={() => void deleteCategory(category)}><ActionIcon name="delete" />删除</button></>}</nav></header><div className="structure-files">{categoryDocs.map((item) => <article className={`${structureDrag?.id === item.id ? "sorting-drag" : ""} ${structureDrag?.kind === "document" && structureDrag.containerId === category.id && structureDrag.id !== item.id ? "structure-sort-target" : ""}`} onDragOver={(event) => previewStructureMove(event, "document", item.id, category.id)} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void commitStructureOrder("document", category.id); }} key={item.id}><div><span className="structure-sort-handle" draggable={!structureBusy} title="拖拽调整文件顺序" onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); beginStructureDrag("document", item.id, category.id, categoryDocs.map((entry) => entry.id)); }} onDragEnd={cancelStructureDrag}><ActionIcon name="drag" /></span><WorkspaceIcon name="docs" /><span><b>{item.title}</b><small>v{item.version || 1} · {formatTime(item.updatedAt)}</small></span></div><nav><button onClick={() => setHistoryDocument(item)}><ActionIcon name="refresh" />修改历史</button><button disabled={structureBusy} onClick={() => void renameDocument(item)}><ActionIcon name="edit" />重命名</button>{canManageStructure && <button className="danger-action" disabled={structureBusy} onClick={() => void deleteDocument(item)}><ActionIcon name="delete" />删除</button>}</nav></article>)}{!categoryDocs.length && <small className="structure-empty">此分类暂无文件</small>}</div>{children.map((child) => structureCategory(child, 1))}</section>;
  }

  const visibleAttachments = useMemo(() => getDocAttachments(doc), [doc]);
  const docHeadings = useMemo(() => getDocumentHeadings(doc?.body || ""), [doc?.body]);
  const editableDoc: EditableKnowledgeDocument | null = editing && editing !== "new" ? { id: editing.id, title: editing.title, group: editing.group, body: editing.body, items: editing.items, attachments: getDocAttachments(editing), collaborators: editing.collaborators, version: editing.version, status: editing.status, treeIcon: editing.treeIcon, treeIconColor: editing.treeIconColor } : null;

  return <section className="docs-page">
    <div className="section-title content-head docs-masthead"><div><p className="eyebrow">{other ? "OTHER KNOWLEDGE" : "COMPANY KNOWLEDGE"}</p><h2>{other ? "其它资料" : "通用资料与规章制度"}</h2><p>{other ? "统一查阅和维护其它类型的知识资料。" : "统一查阅入职、规章与公司通用资料。"}</p></div></div>
    <div className="docs-layout"><aside title="资料目录">{topCategories.map((category) => navigationCategory(category))}</aside>
      {doc ? <DocumentReader readerId={readerId} label={other ? "其它资料" : "制度文件"} title={doc.title} owner={doc.owner} updatedAt={doc.updatedAt} status={doc.status} body={doc.body} headings={docHeadings} activeHeading={activeDocHeading} attachments={visibleAttachments} titleAction={documentCanEdit ? <button className="doc-title-edit" aria-label="编辑文章" onClick={() => setEditing(doc)}><ActionIcon name="edit" /></button> : null} afterBody={<KnowledgeAttachmentLibrary scope={other ? "other-doc" : "doc"} documentId={doc.id} libraryLabel={other ? "其它资料" : "通用资料与规章制度"} currentIds={visibleAttachments.map((item) => item.id)} toast={toast} />} /> : <div className="empty-state"><b>尚未创建资料</b><small>{canEdit ? "点击页面顶部“编辑层级”管理分类与文件" : "管理员尚未添加内容"}</small></div>}
    </div>
    {structureOpen && <div className="modal-backdrop structure-manager-backdrop"><section className="modal document-structure-modal"><header><div><span>DOCUMENT STRUCTURE</span><h2>{other ? "其它资料结构编辑" : "资料结构编辑"}</h2><p>管理一级、二级分类与文件；文章正文需进入文章页面后编辑。</p></div><button className="icon-button" title="关闭" onClick={onCloseStructure}><ActionIcon name="close" /></button></header><div className="structure-toolbar"><div><b>当前文件夹结构</b><small>拖拽手柄可调整同级文件夹与文件顺序 · 最多支持二级分类</small></div>{canManageStructure && <button className="primary" disabled={structureBusy} onClick={() => void createCategory()}><ActionIcon name="add" />新建一级分类</button>}</div><div className="document-structure-tree">{topCategories.map((category) => structureCategory(category))}</div></section></div>}
    {editing && <KnowledgeDocumentEditorDialog record={editableDoc} categories={categoryNames} defaultCategory={editing === "new" ? newDocumentCategory : editableDoc?.group || categoryNames[0] || (other ? "其它资料" : "通用资料")} scope={other ? "other-doc" : "doc"} draftNamespace={other ? "other-doc" : "doc"} title={editing === "new" ? "新建文件" : `编辑文章：${editing.title}`} saveLabel="保存文章" onSave={saveKnowledgeDocument} onEnsureDocument={ensureKnowledgeDocument} onClose={() => setEditing(null)} onCategoryAction={onCategoryAction} canManageCategories={false} toast={toast} />}
    {historyDocument && <VersionHistoryDialog type="doc" entityId={historyDocument.id} currentText={historyDocument.body} onClose={() => setHistoryDocument(null)} onRestored={() => window.location.reload()} />}
  </section>;
}

function formatBytes(size: number | null | undefined) { if (!size) return ""; return size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`; }

function SopPage({ data, brand, product, selected, canEdit, canManageCollaborators, structureOpen, onCloseStructure, setData, onSelect, toast }: { data: WorkspaceState; brand: string; product: string; selected: string; canEdit: boolean; canManageCollaborators: boolean; structureOpen: boolean; onCloseStructure: () => void; setData: (next: WorkspaceState) => void; onSelect: (documentId?: string) => void; toast: (message: string) => void }) {
  const productId = data.productIds[`${brand}/${product}`] || "";
  const productDocs = data.sops.filter((item) => item.brand === brand && item.product === product);
  const categories = data.sopCategories.filter((item) => item.brand === brand && item.product === product).slice().sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-CN"));
  const [structureDrag, setStructureDrag] = useState<StructureDrag | null>(null);
  const [structurePreview, setStructurePreview] = useState<string[]>([]);
  const structureDragRef = useRef<StructureDrag | null>(null);
  const structurePreviewRef = useRef<string[]>([]);
  const structureDropCommitted = useRef(false);
  const topCategories = orderByIds(categories.filter((item) => !item.parentId), structureDrag?.kind === "category" && structureDrag.containerId === "root" ? structurePreview : []);
  const categoryNames = categories.map((item) => item.name);
  const record = productDocs.find((item) => item.id === selected) || productDocs[0] || null;
  const recordCanEdit = Boolean(record && (record.canEdit || (canEdit && !(record.collaborators?.length))));
  const [editing, setEditing] = useState<SopRecord | "new" | null>(null);
  const [newDocumentCategory, setNewDocumentCategory] = useState(categoryNames[0] || "产品资料");
  const [historyDocument, setHistoryDocument] = useState<SopRecord | null>(null);
  const [structureBusy, setStructureBusy] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(() => new Set());
  const [activeHeading, setActiveHeading] = useState(0);

  useEffect(() => {
    const update = () => {
      const nodes = [...document.querySelectorAll<HTMLElement>(documentHeadingSelector("sop-reader"))];
      let current = 0; nodes.forEach((node, index) => { if (node.getBoundingClientRect().top <= 180) current = index + 1; }); setActiveHeading(current);
    };
    window.addEventListener("scroll", update, { passive: true }); update(); return () => window.removeEventListener("scroll", update);
  }, [record?.content]);

  const documentsIn = (category: SopCategoryRecord) => orderByIds(productDocs.filter((item) => item.categoryId ? item.categoryId === category.id : item.group === category.name), structureDrag?.kind === "document" && structureDrag.containerId === category.id ? structurePreview : []);
  const childrenOf = (category: SopCategoryRecord) => orderByIds(categories.filter((item) => item.parentId === category.id), structureDrag?.kind === "category" && structureDrag.containerId === category.id ? structurePreview : []);
  function toggleCategory(id: string) { setCollapsedCategories((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function beginStructureDrag(kindValue: StructureDrag["kind"], id: string, containerId: string, ids: string[]) {
    if (structureBusy) return;
    const nextDrag = { kind: kindValue, id, containerId }; structureDragRef.current = nextDrag; structurePreviewRef.current = ids.slice(); structureDropCommitted.current = false; setStructureDrag(nextDrag); setStructurePreview(ids.slice());
  }
  function previewStructureMove(event: ReactDragEvent<HTMLElement>, kindValue: StructureDrag["kind"], targetId: string, containerId: string) {
    const currentDrag = structureDragRef.current;
    if (!currentDrag || currentDrag.kind !== kindValue || currentDrag.containerId !== containerId) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move";
    if (currentDrag.id === targetId) return;
    const next = moveIdRelative(structurePreviewRef.current, currentDrag.id, targetId, pointerIsAfter(event));
    if (sameOrder(next, structurePreviewRef.current)) return;
    structurePreviewRef.current = next; setStructurePreview(next);
  }
  function cancelStructureDrag() {
    if (structureDropCommitted.current) { structureDropCommitted.current = false; return; }
    if (!structureBusy) { structureDragRef.current = null; structurePreviewRef.current = []; setStructureDrag(null); setStructurePreview([]); }
  }
  async function commitStructureOrder(kindValue: StructureDrag["kind"], containerId: string) {
    const currentDrag = structureDragRef.current;
    if (!currentDrag || currentDrag.kind !== kindValue || currentDrag.containerId !== containerId || !structurePreviewRef.current.length) return cancelStructureDrag();
    structureDropCommitted.current = true; const ids = structurePreviewRef.current.slice(), previous = data;
    const next = kindValue === "category" ? { ...data, sopCategories: applyIdOrder(data.sopCategories, ids) } : { ...data, sops: applyIdOrder(data.sops, ids) };
    setData(next); structureDragRef.current = null; structurePreviewRef.current = []; setStructureDrag(null); setStructurePreview([]); setStructureBusy(true);
    try {
      const response = await fetch("/api/knowledge-documents/order", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "sop", productId, entity: kindValue === "category" ? "categories" : "documents", parentId: kindValue === "category" && containerId !== "root" ? containerId : null, categoryId: kindValue === "document" ? containerId : undefined, ids }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "排序保存失败"); toast("SOP 顺序已保存");
    } catch (error) { setData(previous); toast(error instanceof Error ? error.message : "排序保存失败"); }
    finally { setStructureBusy(false); }
  }

  async function saveDocument(payload: { title: string; group: string; body: string; items: string[]; attachments: string[]; collaborators: Array<{ userId: string; permission: "view" | "edit" }>; status: "draft" | "published" | "archived"; treeIcon: string; treeIconColor: string; version: number }) {
    try {
      const current = editing === "new" ? null : editing;
      const response = await fetch(current ? `/api/sop-documents/${current.id}` : "/api/sop-documents", { method: current ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, productId }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "SOP 文档保存失败");
      const next = { ...(body.sop as SopRecord), canEdit: true, canManage: canManageCollaborators };
      setData({ ...data, sops: current ? data.sops.map((item) => item.id === current.id ? next : item) : [...data.sops, next] });
      onSelect(next.id); toast(current ? "文章已更新" : "文件已创建"); return next;
    } catch (error) { toast(error instanceof Error ? error.message : "SOP 文档保存失败"); return null; }
  }

  async function ensureSopDocument(payload: Parameters<typeof saveDocument>[0]): Promise<EditableKnowledgeDocument | null> {
    if (editing !== "new") return editableRecord;
    try {
      const response = await fetch("/api/sop-documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, productId, status: "draft" }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "SOP 草稿创建失败");
      const next = { ...(body.sop as SopRecord), canEdit: true, canManage: canManageCollaborators };
      setData({ ...data, sops: [...data.sops, next] }); setEditing(next); onSelect(next.id); toast("已自动创建草稿，可继续上传并编辑附件");
      return { id: next.id, title: next.title, group: next.group, body: next.content, items: next.items || [], attachments: next.attachments || [], collaborators: next.collaborators, version: next.version, status: next.status, treeIcon: next.treeIcon, treeIconColor: next.treeIconColor };
    } catch (error) { toast(error instanceof Error ? error.message : "SOP 草稿创建失败"); return null; }
  }

  async function manageCategory(action: "create" | "rename" | "delete", name: string, newName?: string, options?: { categoryId?: string; parentId?: string | null }) {
    try {
      const response = await fetch(`/api/sops/${encodeURIComponent(productId)}/categories`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, name, newName, categoryId: options?.categoryId, parentId: options?.parentId }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "SOP 分类操作失败");
      const deletedDocumentIds = body.deletedDocumentIds || [];
      setData({ ...data, sopCategories: [...data.sopCategories.filter((item) => !(item.brand === brand && item.product === product)), ...(body.categories as SopCategoryRecord[])], sops: action === "delete" ? data.sops.filter((item) => !deletedDocumentIds.includes(item.id)) : action === "rename" ? data.sops.map((item) => (options?.categoryId ? item.categoryId === options.categoryId : item.brand === brand && item.product === product && item.group === name) ? { ...item, group: newName || name } : item) : data.sops });
      if (action === "delete" && record && deletedDocumentIds.includes(record.id)) onSelect(productDocs.find((item) => !deletedDocumentIds.includes(item.id))?.id);
      toast({ create: "SOP 分类已创建", rename: "SOP 分类已重命名", delete: "SOP 分类已删除" }[action]); return true;
    } catch (error) { toast(error instanceof Error ? error.message : "SOP 分类操作失败"); return false; }
  }

  async function createCategory(parent?: SopCategoryRecord) {
    const name = window.prompt(parent ? `在“${parent.name}”下创建二级分类` : "创建一级分类")?.trim(); if (!name) return;
    setStructureBusy(true); await manageCategory("create", name, undefined, { parentId: parent?.id || null }); setStructureBusy(false);
  }
  async function renameCategory(category: SopCategoryRecord) {
    const name = window.prompt("输入新的分类名称", category.name)?.trim(); if (!name || name === category.name) return;
    setStructureBusy(true); await manageCategory("rename", category.name, name, { categoryId: category.id }); setStructureBusy(false);
  }
  async function deleteCategory(category: SopCategoryRecord) {
    const children = childrenOf(category), affected = [category, ...children], fileCount = affected.reduce((sum, item) => sum + documentsIn(item).length, 0);
    const detail = `${children.length ? `同时删除 ${children.length} 个二级分类；` : ""}${fileCount ? `${fileCount} 个文件将移入回收站，可由管理员恢复。` : "分类中没有文件。"}`;
    if (!window.confirm(`确认删除分类“${category.name}”吗？${detail}`)) return;
    setStructureBusy(true); await manageCategory("delete", category.name, undefined, { categoryId: category.id }); setStructureBusy(false);
  }
  function createDocument(category: SopCategoryRecord) { setNewDocumentCategory(category.name); setEditing("new"); }
  async function renameDocument(item: SopRecord) {
    const title = window.prompt("输入新的文件名称", item.title)?.trim(); if (!title || title === item.title) return;
    setStructureBusy(true);
    const response = await fetch(`/api/sop-documents/${item.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, title, group: item.group, body: item.content, items: item.items, attachments: (item.attachments || []).map((attachment) => attachment.id), collaborators: (item.collaborators || []).map((entry) => ({ userId: entry.userId, permission: entry.permission })), status: item.status || "published", treeIcon: item.treeIcon, treeIconColor: item.treeIconColor, version: item.version || 0 }) });
    const body = await response.json(); setStructureBusy(false); if (!response.ok) return toast(body.error || "文件重命名失败");
    setData({ ...data, sops: data.sops.map((sopItem) => sopItem.id === item.id ? { ...body.sop, canEdit: true, canManage: canManageCollaborators } : sopItem) }); toast("文件已重命名");
  }
  async function deleteDocument(item: SopRecord) {
    if (!window.confirm(`确认删除文件“${item.title}”吗？删除后可由管理员从回收站恢复。`)) return;
    setStructureBusy(true); const response = await fetch(`/api/sop-documents/${item.id}`, { method: "DELETE" }); const body = await response.json(); setStructureBusy(false); if (!response.ok) return toast(body.error || "文件删除失败");
    const sops = data.sops.filter((sopItem) => sopItem.id !== item.id); setData({ ...data, sops }); if (selected === item.id) onSelect(sops.find((sopItem) => sopItem.brand === brand && sopItem.product === product)?.id); toast("文件已移入回收站");
  }

  function navigationCategory(category: SopCategoryRecord, level = 0): ReactNode {
    const categoryDocs = documentsIn(category), children = childrenOf(category), collapsed = collapsedCategories.has(category.id), total = categoryDocs.length + children.reduce((sum, child) => sum + documentsIn(child).length, 0);
    return <div className={`doc-group doc-group-level-${level} ${collapsed ? "collapsed" : ""}`} key={category.id}><button className="doc-group-toggle" aria-expanded={!collapsed} onClick={() => toggleCategory(category.id)}><ActionIcon name="folder" size={13} /><span>{category.name}</span><small>{total}</small><ActionIcon name="expand" size={14} /></button>{!collapsed && <>{categoryDocs.map((item) => <button className={item.id === record?.id ? "active" : ""} onClick={() => onSelect(item.id)} key={item.id}><i className="document-tree-icon" style={{ color: item.treeIconColor || "#53617b" }}><WorkspaceIcon name={item.treeIcon || "docs"} size={14} /></i><span>{item.title}</span>{item.status && item.status !== "published" && <em className={`nav-status ${item.status}`}>{item.status === "draft" ? "草稿" : "归档"}</em>}</button>)}{children.map((child) => navigationCategory(child, 1))}{!categoryDocs.length && !children.length && <small className="doc-group-empty">暂无文件</small>}</>}</div>;
  }
  function structureCategory(category: SopCategoryRecord, level = 0): ReactNode {
    const categoryDocs = documentsIn(category), children = childrenOf(category), categoryContainer = category.parentId || "root";
    return <section className={`structure-category structure-level-${level} ${structureDrag?.id === category.id ? "sorting-drag" : ""} ${structureDrag?.kind === "category" && structureDrag.containerId === categoryContainer && structureDrag.id !== category.id ? "structure-sort-target" : ""}`} onDragOver={(event) => previewStructureMove(event, "category", category.id, categoryContainer)} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void commitStructureOrder("category", categoryContainer); }} key={category.id}><header><div><span className="structure-sort-handle" draggable={!structureBusy} title="拖拽调整文件夹顺序" onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", category.id); beginStructureDrag("category", category.id, categoryContainer, categories.filter((item) => item.parentId === category.parentId).map((item) => item.id)); }} onDragEnd={cancelStructureDrag}><ActionIcon name="drag" /></span><ActionIcon name="folder" /><span><b>{category.name}</b><small>{level ? "二级分类" : "一级分类"} · {categoryDocs.length} 个文件</small></span></div><nav><button disabled={structureBusy} onClick={() => createDocument(category)}><ActionIcon name="add" />新建文件</button>{level === 0 && <button disabled={structureBusy} onClick={() => void createCategory(category)}><ActionIcon name="folder" />新建二级分类</button>}<button disabled={structureBusy} onClick={() => void renameCategory(category)}><ActionIcon name="edit" />重命名</button><button className="danger-action" disabled={structureBusy} onClick={() => void deleteCategory(category)}><ActionIcon name="delete" />删除</button></nav></header><div className="structure-files">{categoryDocs.map((item) => <article className={`${structureDrag?.id === item.id ? "sorting-drag" : ""} ${structureDrag?.kind === "document" && structureDrag.containerId === category.id && structureDrag.id !== item.id ? "structure-sort-target" : ""}`} onDragOver={(event) => previewStructureMove(event, "document", item.id, category.id)} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void commitStructureOrder("document", category.id); }} key={item.id}><div><span className="structure-sort-handle" draggable={!structureBusy} title="拖拽调整文件顺序" onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); beginStructureDrag("document", item.id, category.id, categoryDocs.map((entry) => entry.id)); }} onDragEnd={cancelStructureDrag}><ActionIcon name="drag" /></span><WorkspaceIcon name="docs" /><span><b>{item.title}</b><small>v{item.version || 1} · {formatTime(item.updatedAt)}</small></span></div><nav><button onClick={() => setHistoryDocument(item)}><ActionIcon name="refresh" />修改历史</button><button disabled={structureBusy} onClick={() => void renameDocument(item)}><ActionIcon name="edit" />重命名</button><button className="danger-action" disabled={structureBusy} onClick={() => void deleteDocument(item)}><ActionIcon name="delete" />删除</button></nav></article>)}{!categoryDocs.length && <small className="structure-empty">此分类暂无文件</small>}</div>{children.map((child) => structureCategory(child, 1))}</section>;
  }
  const headings = getDocumentHeadings(record?.content || "");
  const editableRecord: EditableKnowledgeDocument | null = editing && editing !== "new" ? { id: editing.id, title: editing.title, group: editing.group, body: editing.content, items: editing.items || [], attachments: editing.attachments || [], collaborators: editing.collaborators, version: editing.version, status: editing.status, treeIcon: editing.treeIcon, treeIconColor: editing.treeIconColor } : null;

  return <section className="sop-page docs-page">
    <div className="section-title content-head docs-masthead"><div><p className="eyebrow">STANDARD OPERATING PROCEDURE</p><h2>{brand} · {product} SOP</h2><p>统一查阅当前产品线的标准作业流程与配套资料。</p></div></div>
    <div className="docs-layout sop-docs-layout"><aside title="当前产品 SOP 目录">{topCategories.map((category) => navigationCategory(category))}</aside>
      <div className="sop-main-column">{record ? <DocumentReader readerId="sop-reader" label={`${brand} · ${product} / ${record.group}`} title={record.title} owner={record.updatedBy} updatedAt={record.updatedAt} status={record.status} body={record.content} headings={headings} activeHeading={activeHeading} attachments={record.attachments || []} titleAction={recordCanEdit ? <button className="doc-title-edit" aria-label="编辑文章" onClick={() => setEditing(record)}><ActionIcon name="edit" /></button> : null} afterBody={<KnowledgeAttachmentLibrary scope="sop" brand={brand} product={product} documentId={record.id} currentIds={(record.attachments || []).map((item) => item.id)} toast={toast} />} /> : <div className="empty-state sop-empty-state"><ActionIcon name="docs" size={26} /><b>该产品尚未创建 SOP 文档</b><small>{canEdit ? "点击页面顶部“编辑层级”管理分类与文件" : "维护人员尚未添加内容"}</small></div>}</div>
    </div>
    {structureOpen && <div className="modal-backdrop structure-manager-backdrop"><section className="modal document-structure-modal"><header><div><span>DOCUMENT STRUCTURE</span><h2>SOP 结构编辑</h2><p>管理一级、二级分类与文件；文章正文需进入文章页面后编辑。</p></div><button className="icon-button" title="关闭" onClick={onCloseStructure}><ActionIcon name="close" /></button></header><div className="structure-toolbar"><div><b>{brand} · {product} 文件夹结构</b><small>拖拽手柄可调整同级文件夹与文件顺序 · 最多支持二级分类</small></div><button className="primary" disabled={structureBusy} onClick={() => void createCategory()}><ActionIcon name="add" />新建一级分类</button></div><div className="document-structure-tree">{topCategories.map((category) => structureCategory(category))}</div></section></div>}
    {editing && <KnowledgeDocumentEditorDialog record={editableRecord} categories={categoryNames.length ? categoryNames : ["产品资料"]} defaultCategory={editing === "new" ? newDocumentCategory : editableRecord?.group || categoryNames[0] || "产品资料"} scope="sop" brand={brand} product={product} title={editing === "new" ? "新建文件" : `编辑文章：${editing.title}`} saveLabel="保存文章" onSave={saveDocument} onEnsureDocument={ensureSopDocument} onClose={() => setEditing(null)} onCategoryAction={manageCategory} canManageCategories={false} toast={toast} />}
    {historyDocument && <VersionHistoryDialog type="sop" entityId={historyDocument.id} currentText={historyDocument.content} onClose={() => setHistoryDocument(null)} onRestored={() => window.location.reload()} />}
  </section>;
}

export function ProductTemplates({ brand, product, productId, canEdit, toast }: { brand: string; product: string; productId: string; canEdit: boolean; toast: (message: string) => void }) {
  const [templates, setTemplates] = useState<ProductTemplateRecord[]>([]); const [editing, setEditing] = useState<ProductTemplateRecord | "new" | null>(null); const [expanded, setExpanded] = useState<string | null>(null); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [dragTemplate, setDragTemplate] = useState<string | null>(null); const [templateSortBusy, setTemplateSortBusy] = useState(false); const templateOrderBeforeDrag = useRef<ProductTemplateRecord[]>([]); const templatePreviewRef = useRef<ProductTemplateRecord[]>([]); const dragTemplateRef = useRef<string | null>(null); const templateDropCommitted = useRef(false);
  async function load() { setLoading(true); try { const [response, preferenceResponse] = await Promise.all([fetch(`/api/product-templates?brand=${encodeURIComponent(brand)}&product=${encodeURIComponent(product)}`), fetch(`/api/preferences?key=product-template-order:${encodeURIComponent(productId)}`)]); const body = await response.json(), preference = await preferenceResponse.json(); if (!response.ok) throw new Error(body.error); const position = new Map<string, number>((preferenceResponse.ok ? preference.ids || [] : []).map((id: string, index: number) => [id, index])); setTemplates([...(body.templates || [])].sort((left: ProductTemplateRecord, right: ProductTemplateRecord) => (position.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(right.id) ?? Number.MAX_SAFE_INTEGER))); } catch (error) { toast(error instanceof Error ? error.message : "产品模板读取失败"); } finally { setLoading(false); } }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load is recreated around the current brand/product query.
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [brand, product]);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); try { const form = new FormData(event.currentTarget); form.set("brand", brand); form.set("product", product); const current = editing === "new" ? null : editing; const response = await fetch(current ? `/api/product-templates/${current.id}` : "/api/product-templates", { method: current ? "PUT" : "POST", body: form }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "模板保存失败"); setEditing(null); await load(); toast(current ? "产品模板已更新" : "产品模板已创建"); } catch (error) { toast(error instanceof Error ? error.message : "模板保存失败"); } finally { setBusy(false); } }
  async function remove(template: ProductTemplateRecord) { if (!window.confirm(`确认删除“${template.title}”及其附件吗？`)) return; const response = await fetch(`/api/product-templates/${template.id}`, { method: "DELETE" }); const body = await response.json(); if (!response.ok) return toast(body.error || "模板删除失败"); await load(); toast("产品模板已删除"); }
  function startTemplateSort(event: ReactDragEvent<HTMLElement>, id: string) { if (templateSortBusy || !canEdit) return; event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); templateOrderBeforeDrag.current = templates.slice(); templatePreviewRef.current = templates.slice(); dragTemplateRef.current = id; templateDropCommitted.current = false; setDragTemplate(id); }
  function previewTemplateSort(event: ReactDragEvent<HTMLElement>, targetId: string) { const sourceId = dragTemplateRef.current; if (!sourceId) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (sourceId === targetId) return; const ids = templatePreviewRef.current.map((item) => item.id); const nextIds = moveIdRelative(ids, sourceId, targetId, pointerIsAfter(event, "grid")); if (sameOrder(ids, nextIds)) return; const position = new Map(nextIds.map((id, index) => [id, index])); const next = templatePreviewRef.current.slice().sort((left, right) => position.get(left.id)! - position.get(right.id)!); templatePreviewRef.current = next; setTemplates(next); }
  async function commitTemplateSort(event: ReactDragEvent<HTMLElement>) { event.preventDefault(); event.stopPropagation(); if (!dragTemplateRef.current) return; templateDropCommitted.current = true; const next = templatePreviewRef.current.slice(); dragTemplateRef.current = null; setDragTemplate(null); setTemplateSortBusy(true); try { const response = await fetch("/api/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: `product-template-order:${productId}`, ids: next.map((item) => item.id) }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "排序保存失败"); toast("个人模板排序已保存"); } catch (error) { setTemplates(templateOrderBeforeDrag.current); toast(error instanceof Error ? error.message : "排序保存失败"); } finally { setTemplateSortBusy(false); templateOrderBeforeDrag.current = []; templatePreviewRef.current = []; templateDropCommitted.current = false; } }
  function cancelTemplateSort() { if (templateDropCommitted.current) { templateDropCommitted.current = false; return; } if (!templateSortBusy) { if (templateOrderBeforeDrag.current.length) setTemplates(templateOrderBeforeDrag.current); setDragTemplate(null); dragTemplateRef.current = null; templateOrderBeforeDrag.current = []; templatePreviewRef.current = []; } }
  return <section className="product-templates"><header><div><span><WorkspaceIcon name="templates" /></span><h2>本产品线模板库</h2><em>{loading ? "读取中" : `${templates.length} 个模板 · ${templateSortBusy ? "正在保存排序" : "拖拽手柄排序"}`}</em></div>{canEdit && <button className="secondary" onClick={() => setEditing("new")}><ActionIcon name="add" />新增模板</button>}</header>{templates.length ? <div className="mini-template-grid">{templates.map((template) => <article className={dragTemplate === template.id ? "sorting-drag" : ""} onDragOver={(event) => previewTemplateSort(event, template.id)} onDrop={(event) => void commitTemplateSort(event)} key={template.id}>{canEdit && <span className="template-sort-handle" draggable={!templateSortBusy} title="拖拽排序" onDragStart={(event) => startTemplateSort(event, template.id)} onDragEnd={cancelTemplateSort}><ActionIcon name="drag" />产品专属</span>}<h3>{template.title}</h3><p>{template.summary || "该产品线的可复用工作模板"}</p>{expanded === template.id && <div className="product-template-preview ionic-doc-theme"><KnowledgeMarkdown markdown={template.content} /></div>}<small>更新：{template.updatedBy} · {formatTime(template.updatedAt)}</small><div><button onClick={() => setExpanded(expanded === template.id ? null : template.id)}><ActionIcon name={expanded === template.id ? "hide" : "show"} />{expanded === template.id ? "收起" : "预览"}</button><button onClick={() => { navigator.clipboard.writeText(template.content); toast("模板内容已复制"); }}><ActionIcon name="copy" />复制文本</button>{template.attachmentId && <a href={`/api/workspace-attachments/${template.attachmentId}`} target="_blank" rel="noreferrer"><ActionIcon name="download" />下载附件</a>}{canEdit && <><button onClick={() => setEditing(template)}><ActionIcon name="edit" />编辑</button><button className="danger-action" onClick={() => remove(template)}><ActionIcon name="delete" />删除</button></>}</div></article>)}</div> : !loading && <div className="empty-state"><ActionIcon name="folder" size={26} /><b>该产品线暂无专属模板</b><small>{canEdit ? "点击“新增模板”创建第一项" : "维护人员尚未添加模板"}</small></div>}{editing && <div className="modal-backdrop"><form className="modal product-template-modal" onSubmit={submit}><header><div><span>PRODUCT TEMPLATE</span><h2>{editing === "new" ? "新增产品模板" : "编辑产品模板"}</h2><p>{brand} · {product}</p></div><button className="icon-button" title="关闭" type="button" onClick={() => setEditing(null)}><ActionIcon name="close" /></button></header><div className="form-grid"><label>模板名称<input name="title" required maxLength={80} defaultValue={editing === "new" ? "" : editing.title} /></label><label>一句话说明<input name="summary" maxLength={160} defaultValue={editing === "new" ? "" : editing.summary} /></label><label className="form-wide">模板正文（Markdown）<textarea name="content" required rows={12} defaultValue={editing === "new" ? "" : editing.content} /></label><label className="form-wide file-field">附件 <small>最大 200 MB，禁止脚本和可执行文件</small><input name="attachment" type="file" /></label>{editing !== "new" && editing.attachmentId && <label className="remove-file"><input name="removeAttachment" value="true" type="checkbox" /> 删除现有附件：{editing.attachmentName}</label>}</div><footer className="dialog-actions"><button type="button" onClick={() => setEditing(null)}>取消</button><button className="primary" disabled={busy}><ActionIcon name="save" />{busy ? "正在保存…" : "保存模板"}</button></footer></form></div>}</section>;
}

function TrackerPage({ data, brand, product, canEdit, setData, toast }: { data: WorkspaceState; brand: string; product: string; canEdit: boolean; setData: (next: WorkspaceState) => void; toast: (message: string) => void }) {
  const baseRecords = data.links.filter((item) => item.brand === brand && item.product === product); const [editing, setEditing] = useState<LinkRecord | null | "new">(null); const [editMode, setEditMode] = useState(false); const [dragId, setDragId] = useState<string | null>(null); const [previewOrder, setPreviewOrder] = useState<string[]>([]); const [sortBusy, setSortBusy] = useState(false);
  const dragIdRef = useRef<string | null>(null); const previewOrderRef = useRef<string[]>([]); const trackerDropCommitted = useRef(false);
  const records = orderByIds(baseRecords, previewOrder);
  function startDrag(event: ReactDragEvent<HTMLElement>, record: LinkRecord) { if (sortBusy) return; event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", record.id); const ids = baseRecords.map((item) => item.id); dragIdRef.current = record.id; previewOrderRef.current = ids; trackerDropCommitted.current = false; setDragId(record.id); setPreviewOrder(ids); }
  function previewMove(event: ReactDragEvent<HTMLElement>, target: LinkRecord) { const sourceId = dragIdRef.current; if (!sourceId) return; const source = baseRecords.find((item) => item.id === sourceId); if (!source || source.cycle !== target.cycle) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; if (sourceId === target.id) return; const next = moveIdRelative(previewOrderRef.current, sourceId, target.id, pointerIsAfter(event, "grid")); if (sameOrder(next, previewOrderRef.current)) return; previewOrderRef.current = next; setPreviewOrder(next); }
  function cancelDrag() { if (trackerDropCommitted.current) { trackerDropCommitted.current = false; return; } if (sortBusy) return; dragIdRef.current = null; previewOrderRef.current = []; setDragId(null); setPreviewOrder([]); }
  async function remove(record: LinkRecord) { if (!window.confirm(`确认删除“${record.name}”吗？`)) return; const response = await fetch(`/api/tracker-links/${record.id}`, { method: "DELETE" }); const body = await response.json(); if (!response.ok) return toast(body.error || "链接删除失败"); setData({ ...data, links: data.links.filter((item) => item.id !== record.id) }); toast("链接已移入回收状态"); }
  async function drop(event: ReactDragEvent<HTMLElement>, target: LinkRecord) { event.preventDefault(); event.stopPropagation(); const sourceId = dragIdRef.current; if (!sourceId || sortBusy) return; const source = data.links.find((item) => item.id === sourceId); if (!source || source.cycle !== target.cycle) { cancelDrag(); return toast("仅支持在同一维护周期内排序"); } trackerDropCommitted.current = true; const ordered = previewOrderRef.current.map((id) => data.links.find((item) => item.id === id)).filter((item): item is LinkRecord => Boolean(item && item.cycle === target.cycle)); const cycleIds = new Set(ordered.map((item) => item.id)); let pointer = 0; const links = data.links.map((item) => cycleIds.has(item.id) ? ordered[pointer++] : item); const previous = data, productId = data.productIds[`${brand}/${product}`]; setData({ ...data, links }); dragIdRef.current = null; previewOrderRef.current = []; setDragId(null); setPreviewOrder([]); setSortBusy(true); try { const response = await fetch("/api/tracker-links/order", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, cycle: target.cycle, ids: ordered.map((item) => item.id) }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "排序保存失败"); toast("排序已保存"); } catch (error) { setData(previous); toast(error instanceof Error ? error.message : "排序保存失败"); } finally { setSortBusy(false); trackerDropCommitted.current = false; } }
  async function saveLink(record: LinkRecord) { const current = editing === "new" ? null : editing; const productId = data.productIds[`${brand}/${product}`]; const response = await fetch(current ? `/api/tracker-links/${current.id}` : "/api/tracker-links", { method: current ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...record, productId, version: current?.version || 0 }) }); const body = await response.json(); if (!response.ok) return toast(body.error || "链接保存失败"); const saved = body.link as LinkRecord; setData({ ...data, links: current ? data.links.map((item) => item.id === current.id ? saved : item) : [...data.links, saved] }); toast(current ? "链接已更新" : "链接已添加"); setEditing(null); }
  return <section className={`tracker-page ${editMode ? "editing-mode" : ""}`}><header className="content-head"><div><p className="eyebrow">PROJECT TRACKER INDEX</p><h1>{brand} · {product}</h1><p>集中管理项目表格与周期性维护入口。</p></div>{canEdit && <div className="content-head-actions"><button className={`secondary ${editMode ? "active" : ""}`} onClick={() => { setEditMode(!editMode); cancelDrag(); }}><ActionIcon name={editMode ? "check" : "edit"} />{editMode ? "完成编辑" : "编辑"}</button><button className="primary" onClick={() => setEditing("new")}><ActionIcon name="add" />添加链接</button></div>}</header>{Object.keys(cycleLabels).map((cycle) => { const items = records.filter((item) => item.cycle === cycle); return <section className="cycle-section" key={cycle}><header><h2>{cycleLabels[cycle]}</h2><span>{items.length}</span><i /></header>{items.length ? <div className="tracker-grid">{items.map((record) => <article className={`tracker-card ${dragId === record.id ? "dragging" : ""}`} onDragOver={(event) => previewMove(event, record)} onDrop={(event) => void drop(event, record)} style={{ background: record.color, color: contrast(record.color) }} key={record.id}><div className="card-tools"><button title="复制链接" onClick={() => { navigator.clipboard.writeText(`【${record.name}】（${record.url}）`); toast("链接已复制"); }}><ActionIcon name="copy" /></button>{canEdit && editMode && <><button title="编辑" onClick={() => setEditing(record)}><ActionIcon name="edit" /></button><button title="删除" onClick={() => remove(record)}><ActionIcon name="delete" /></button></>}</div><span>{record.platform || "其它"}</span><h3 title={record.name}>{record.name}</h3><p>{record.note}</p><a href={record.url} target="_blank" rel="noreferrer"><ActionIcon name="open" />打开文档</a>{canEdit && editMode && <b className="drag-handle" draggable={!sortBusy} title={sortBusy ? "正在保存排序" : "拖拽排序"} onDragStart={(event) => startDrag(event, record)} onDragEnd={cancelDrag}><ActionIcon name="drag" /></b>}</article>)}</div> : <div className="empty-state"><ActionIcon name="folder" size={26} /><b>该分类暂无内容</b><small>{canEdit ? "点击“添加链接”创建第一条记录" : "维护人员尚未添加链接"}</small></div>}</section>; })}{editing && <LinkDialog record={editing === "new" ? null : editing} brand={brand} product={product} onClose={() => setEditing(null)} onSave={saveLink} />}</section>;
}

function LinkDialog({ record, brand, product, onClose, onSave }: { record: LinkRecord | null; brand: string; product: string; onClose: () => void; onSave: (record: LinkRecord) => void }) {
  const [color, setColor] = useState(record?.color || "#2859e8"); const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get("name") || "").trim(), url = String(form.get("url") || "").trim(); if (name.length > 15) return setError("名称不能超过 15 个字"); try { new URL(url); } catch { return setError("请输入有效的网址"); } onSave({ id: record?.id || crypto.randomUUID(), brand, product, name, url, cycle: String(form.get("cycle")), platform: String(form.get("platform")), note: String(form.get("note") || ""), color, createdAt: record?.createdAt || new Date().toISOString() }); }
  // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the visible close button is the keyboard path.
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="modal link-modal" onSubmit={submit}><header><div><span>PROJECT LINK</span><h2>{record ? "编辑链接" : "添加链接"}</h2></div><button type="button" onClick={onClose}>×</button></header>{error && <p className="form-error">{error}</p>}<label>名称 <b>*</b><input name="name" maxLength={15} required defaultValue={record?.name} placeholder="文档名称" /><small>最多 15 个字</small></label><label>链接 <b>*</b><input name="url" type="url" required defaultValue={record?.url} placeholder="https://…" /></label><div className="two-fields"><label>更新周期 <b>*</b><select name="cycle" defaultValue={record?.cycle || "daily"}>{Object.entries(cycleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>平台<select name="platform" defaultValue={record?.platform || ""}><option value="">—</option><option>腾讯</option><option>钉钉</option><option>飞书</option><option>其它</option></select></label></div><label>备注<textarea name="note" defaultValue={record?.note} placeholder="用途或维护说明" /></label><label>卡片颜色<div className="color-row">{["#2859e8", "#5a7f45", "#c54526", "#6757f5", "#0c7c86", "#17243b"].map((value) => <button type="button" aria-label={`选择 ${value}`} className={color === value ? "active" : ""} style={{ background: value }} onClick={() => setColor(value)} key={value} />)}<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></div><span className="color-preview" style={{ background: color, color: contrast(color) }}>预览：文字自动适配可读性</span></label><footer><button type="button" onClick={onClose}>取消</button><button className="primary" type="submit">保存</button></footer></form></div>;
}

function SearchDialog({ query, setQuery, onClose, onOpen }: { query: string; setQuery: (value: string) => void; onClose: () => void; onOpen: (result: SearchResult) => void }) {
  const normalized = query.trim(); const [results, setResults] = useState<SearchResult[]>([]); const [active, setActive] = useState(0); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  useEffect(() => { if (!normalized) return; const controller = new AbortController(); const timer = window.setTimeout(() => { setLoading(true); fetch(`/api/search?q=${encodeURIComponent(normalized)}`, { signal: controller.signal }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "搜索失败"); setResults(body.results || []); setActive(0); setError(""); }).catch((reason) => { if (reason.name !== "AbortError") setError(reason instanceof Error ? reason.message : "搜索失败"); }).finally(() => setLoading(false)); }, 180); return () => { window.clearTimeout(timer); controller.abort(); }; }, [normalized]);
  useEffect(() => { const keys = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); else if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => results.length ? (value + 1) % results.length : 0); } else if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => results.length ? (value - 1 + results.length) % results.length : 0); } else if (event.key === "Enter" && results[active]) { event.preventDefault(); onOpen(results[active]); } }; window.addEventListener("keydown", keys); return () => window.removeEventListener("keydown", keys); }, [onClose, onOpen, results, active]);
  return <div className="modal-backdrop search-backdrop"><div className="search-dialog"><header><span><ActionIcon name="search" /></span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资料、SOP、链接、术语或模板…" /><kbd>ESC</kbd></header><div className="search-results">{!normalized ? <div className="search-empty"><b>输入关键词开始全局检索</b><p>结果来自当前数据库，并按账号权限过滤</p></div> : loading ? <div className="search-empty"><b>正在搜索…</b></div> : error ? <div className="search-empty"><b>搜索暂不可用</b><p>{error}</p></div> : results.length ? results.map((result, index) => <button className={active === index ? "active" : ""} onMouseEnter={() => setActive(index)} onClick={() => onOpen(result)} key={`${result.type}-${result.entityId}`}><span className={`search-result-type search-result-${result.type === "文章" ? "article" : result.type === "附件" ? "attachment" : "term"}`}>{result.type}</span><div><b>{result.title}</b><p>{result.desc}</p></div><em><ActionIcon name={result.url ? "download" : "next"} /></em></button>) : <div className="search-empty"><b>没有找到“{query}”</b><p>换一个关键词试试</p></div>}</div><footer><span>↑↓ 选择</span><span>Enter 打开</span><button onClick={onClose}>关闭</button></footer></div></div>;
}

function AdminConsole({ profile, data, persist, reorderCatalog, catalogAction, toast, onClose }: { profile: UserRecord; data: WorkspaceState; persist: (next: WorkspaceState, message: string) => void; reorderCatalog: (kind: "brands" | "products", names: string[], targetBrand?: string) => Promise<boolean>; catalogAction: (method: "PUT" | "DELETE", payload: Record<string, unknown>, message: string) => Promise<boolean>; toast: (message: string) => void; onClose: () => void }) {
  void toast;
  const [tab, setTab] = useState<"catalog" | "members" | "export" | "audit">("catalog");
  const [activeBrand, setActiveBrand] = useState(data.brands[0] || "");
  const [brandIcon, setBrandIcon] = useState("building");
  const [productIcon, setProductIcon] = useState("package");
  const [brandDrag, setBrandDrag] = useState<string | null>(null); const [brandPreview, setBrandPreview] = useState<string[]>([]); const [productDrag, setProductDrag] = useState<string | null>(null); const [productPreview, setProductPreview] = useState<string[]>([]); const [catalogSortBusy, setCatalogSortBusy] = useState(false); const brandDragRef = useRef<string | null>(null); const brandPreviewRef = useRef<string[]>([]); const productDragRef = useRef<string | null>(null); const productPreviewRef = useRef<string[]>([]); const catalogDropCommitted = useRef(false);
  function addBrand(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get("name") || "").trim(); if (!name || data.brands.includes(name)) return; persist({ ...data, brands: [...data.brands, name], productsByBrand: { ...data.productsByBrand, [name]: [] }, brandIds: { ...data.brandIds, [name]: crypto.randomUUID() }, brandIcons: { ...data.brandIcons, [name]: brandIcon } }, "品牌已创建"); setActiveBrand(name); event.currentTarget.reset(); }
  function addProduct(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get("name") || "").trim(); const current = data.productsByBrand[activeBrand] || []; if (!activeBrand || !name || current.includes(name)) return; persist({ ...data, productsByBrand: { ...data.productsByBrand, [activeBrand]: [...current, name] }, productIds: { ...data.productIds, [`${activeBrand}/${name}`]: crypto.randomUUID() }, productIcons: { ...data.productIcons, [`${activeBrand}/${name}`]: productIcon } }, "产品已创建"); event.currentTarget.reset(); }
  async function renameBrand(name: string) { const next = window.prompt("输入新的品牌名称", name)?.trim(); if (!next || next === name) return; if (await catalogAction("PUT", { kind: "brand", id: data.brandIds[name], name: next }, "品牌已重命名")) setActiveBrand(next); }
  async function renameProduct(name: string) { const next = window.prompt("输入新的产品名称", name)?.trim(); if (!next || next === name) return; await catalogAction("PUT", { kind: "product", id: data.productIds[`${activeBrand}/${name}`], name: next }, "产品已重命名"); }
  async function removeBrand(name: string) { if (!window.confirm(`确认删除品牌“${name}”？只有不存在产品、SOP、链接、模板和附件时才允许删除。`)) return; if (await catalogAction("DELETE", { kind: "brand", id: data.brandIds[name] }, "品牌已删除")) setActiveBrand(data.brands.find((item) => item !== name) || ""); }
  async function removeProduct(name: string) { if (!window.confirm(`确认删除产品“${name}”？有关联内容时系统会阻止删除。`)) return; await catalogAction("DELETE", { kind: "product", id: data.productIds[`${activeBrand}/${name}`] }, "产品已删除"); }
  const visibleBrands = brandPreview.length ? brandPreview : data.brands;
  const currentProducts = data.productsByBrand[activeBrand] || [];
  const visibleProducts = productPreview.length ? productPreview : currentProducts;
  function startBrandSort(event: ReactDragEvent<HTMLElement>, id: string) { if (catalogSortBusy) return; event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); brandDragRef.current = id; brandPreviewRef.current = data.brands.slice(); catalogDropCommitted.current = false; setBrandDrag(id); setBrandPreview(data.brands.slice()); }
  function previewBrandSort(event: ReactDragEvent<HTMLElement>, target: string) { const sourceId = brandDragRef.current; if (!sourceId) return; const source = data.brands.find((item) => data.brandIds[item] === sourceId), targetName = data.brands.find((item) => data.brandIds[item] === target); if (!source || !targetName) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (sourceId === target) return; const next = moveIdRelative(brandPreviewRef.current, source, targetName, pointerIsAfter(event)); if (sameOrder(next, brandPreviewRef.current)) return; brandPreviewRef.current = next; setBrandPreview(next); }
  async function commitBrandSort(event: ReactDragEvent<HTMLElement>) { event.preventDefault(); event.stopPropagation(); if (!brandDragRef.current || !brandPreviewRef.current.length) return; catalogDropCommitted.current = true; const brands = brandPreviewRef.current.slice(); setBrandDrag(null); setCatalogSortBusy(true); await reorderCatalog("brands", brands); setCatalogSortBusy(false); brandDragRef.current = null; brandPreviewRef.current = []; setBrandPreview([]); }
  function startProductSort(event: ReactDragEvent<HTMLElement>, id: string) { if (catalogSortBusy) return; event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); productDragRef.current = id; productPreviewRef.current = currentProducts.slice(); catalogDropCommitted.current = false; setProductDrag(id); setProductPreview(currentProducts.slice()); }
  function previewProductSort(event: ReactDragEvent<HTMLElement>, target: string) { const sourceId = productDragRef.current; if (!sourceId) return; const source = currentProducts.find((item) => data.productIds[`${activeBrand}/${item}`] === sourceId), targetName = currentProducts.find((item) => data.productIds[`${activeBrand}/${item}`] === target); if (!source || !targetName) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (sourceId === target) return; const next = moveIdRelative(productPreviewRef.current, source, targetName, pointerIsAfter(event, "grid")); if (sameOrder(next, productPreviewRef.current)) return; productPreviewRef.current = next; setProductPreview(next); }
  async function commitProductSort(event: ReactDragEvent<HTMLElement>) { event.preventDefault(); event.stopPropagation(); if (!productDragRef.current || !productPreviewRef.current.length) return; catalogDropCommitted.current = true; const ordered = productPreviewRef.current.slice(); setProductDrag(null); setCatalogSortBusy(true); await reorderCatalog("products", ordered, activeBrand); setCatalogSortBusy(false); productDragRef.current = null; productPreviewRef.current = []; setProductPreview([]); }
  function cancelCatalogSort() { if (catalogDropCommitted.current) { catalogDropCommitted.current = false; return; } if (catalogSortBusy) return; brandDragRef.current = null; brandPreviewRef.current = []; productDragRef.current = null; productPreviewRef.current = []; setBrandDrag(null); setBrandPreview([]); setProductDrag(null); setProductPreview([]); }
  return <div className="modal-backdrop"><section className="modal admin-console">
    <header><div><span>ADMIN CONSOLE</span><h2>管理员后台</h2><p>维护目录、成员、知识导出与审计记录。</p></div><button className="icon-button" title="关闭" onClick={onClose}><ActionIcon name="close" /></button></header>
    <nav className="admin-tabs"><button className={tab === "catalog" ? "active" : ""} onClick={() => setTab("catalog")}>品牌与产品</button><button className={tab === "members" ? "active" : ""} onClick={() => setTab("members")}>账号与权限</button><button className={tab === "export" ? "active" : ""} onClick={() => setTab("export")}>批量导出</button><button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}>审计与回收</button></nav>
    {tab === "members" ? <PermissionsDialog profile={profile} data={data} embedded /> : tab === "export" ? <AdminExportPanel data={data} /> : tab === "audit" ? <AuditPanel toast={toast} /> : <div className="catalog-admin">
      <div className="catalog-column"><h3>品牌 <small>{catalogSortBusy ? "正在保存排序…" : "拖拽手柄保存全局顺序"}</small></h3><form className="catalog-create" onSubmit={addBrand}><input name="name" required maxLength={40} placeholder="品牌名称" /><IconPicker value={brandIcon} onChange={setBrandIcon} /><button className="primary"><ActionIcon name="add" />创建品牌</button></form>{activeBrand && <div className="existing-icon-edit"><small>当前品牌图标</small><IconPicker compact value={data.brandIcons[activeBrand] || "building"} onChange={(icon) => persist({ ...data, brandIcons: { ...data.brandIcons, [activeBrand]: icon } }, "品牌图标已更新")} /></div>}<div className="catalog-list">{visibleBrands.map((name) => { const id = data.brandIds[name]; return <button className={`${activeBrand === name ? "active" : ""} ${brandDrag === id ? "sorting-drag" : ""}`} onDragOver={(event) => previewBrandSort(event, id)} onDrop={(event) => void commitBrandSort(event)} onClick={() => { if (!brandDrag) setActiveBrand(name); }} key={id}><span><WorkspaceIcon name={data.brandIcons[name]} /></span><b>{name}<small>{(data.productsByBrand[name] || []).length} 个产品</small></b><em className="catalog-row-actions"><i className="catalog-sort-handle" draggable={!catalogSortBusy} title="拖拽排序" onDragStart={(event) => startBrandSort(event, id)} onDragEnd={cancelCatalogSort}><ActionIcon name="drag" /></i><i role="button" title="重命名" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") renameBrand(name); }} onClick={(event) => { event.stopPropagation(); renameBrand(name); }}><ActionIcon name="edit" /></i><i role="button" title="删除" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") removeBrand(name); }} onClick={(event) => { event.stopPropagation(); removeBrand(name); }}><ActionIcon name="delete" /></i></em></button>; })}</div></div>
      <div className="catalog-column"><h3>{activeBrand || "请选择品牌"} · 产品 <small>{catalogSortBusy ? "正在保存排序…" : "拖拽手柄排序"}</small></h3>{activeBrand && <form className="catalog-create" onSubmit={addProduct}><input name="name" required maxLength={40} placeholder="产品名称" /><IconPicker value={productIcon} onChange={setProductIcon} /><button className="primary"><ActionIcon name="add" />创建产品</button></form>}<div className="product-admin-grid">{visibleProducts.map((name) => { const id = data.productIds[`${activeBrand}/${name}`]; return <article className={productDrag === id ? "sorting-drag" : ""} onDragOver={(event) => previewProductSort(event, id)} onDrop={(event) => void commitProductSort(event)} key={id}><IconPicker compact value={data.productIcons[`${activeBrand}/${name}`] || "package"} onChange={(icon) => persist({ ...data, productIcons: { ...data.productIcons, [`${activeBrand}/${name}`]: icon } }, "产品图标已更新")} /><b>{name}</b><button title="重命名" onClick={() => renameProduct(name)}><ActionIcon name="edit" /></button><button title="删除" onClick={() => removeProduct(name)}><ActionIcon name="delete" /></button><i className="sort-grip catalog-sort-handle" draggable={!catalogSortBusy} title="拖拽排序" onDragStart={(event) => startProductSort(event, id)} onDragEnd={cancelCatalogSort}><ActionIcon name="drag" /></i></article>; })}</div></div>
    </div>}
  </section></div>;
}

function AdminExportPanel({ data }: { data: WorkspaceState }) {
  return <section className="admin-export-panel">
    <header className="admin-export-intro"><span><ActionIcon name="download" size={24} /></span><div><h3>知识库批量导出</h3><p>导出 Markdown 文档、附件历史版本与清单文件。此功能仅对管理员开放。</p></div></header>
    <div className="admin-export-groups">
      <article className="admin-export-group"><div><WorkspaceIcon name="docs" /><span><b>通用资料与规章制度</b><small>导出全部通用资料及其附件</small></span></div><a className="primary button-link" href="/api/knowledge-export?kind=general"><ActionIcon name="download" />导出 ZIP</a></article>
      <article className="admin-export-group"><div><WorkspaceIcon name="other" /><span><b>其它资料</b><small>导出全部其它资料及其附件</small></span></div><a className="primary button-link" href="/api/knowledge-export?kind=other"><ActionIcon name="download" />导出 ZIP</a></article>
      {data.brands.map((brand) => <section className="admin-export-brand" key={data.brandIds[brand] || brand}><h4><WorkspaceIcon name={data.brandIcons[brand] || "building"} />{brand}</h4><div>{(data.productsByBrand[brand] || []).map((product) => { const productId = data.productIds[`${brand}/${product}`]; return productId ? <article className="admin-export-group" key={productId}><div><WorkspaceIcon name={data.productIcons[`${brand}/${product}`] || "package"} /><span><b>{product} SOP</b><small>导出该产品的全部 SOP 文档及附件</small></span></div><a className="secondary button-link" href={`/api/knowledge-export?kind=sop&productId=${encodeURIComponent(productId)}`}><ActionIcon name="download" />导出 ZIP</a></article> : null; })}</div></section>)}
    </div>
  </section>;
}

function AuditPanel({ toast }: { toast: (message: string) => void }) {
  const [logs, setLogs] = useState<Array<{ id: string; actorName: string; action: string; entityType: string; detail: string; createdAt: string }>>([]); const [items, setItems] = useState<Array<{ id: string; title: string; type: "doc" | "sop" | "tracker-link"; deletedAt: string }>>([]); const [orphanFiles, setOrphanFiles] = useState<Array<{ id: string; name: string; title: string; size: number; scope: string; brand: string; product: string; createdAt: string; reason: string }>>([]); const [loading, setLoading] = useState(true);
  async function load() { setLoading(true); try { const [auditResponse, recycleResponse, cleanupResponse] = await Promise.all([fetch("/api/admin/audit?limit=100"), fetch("/api/admin/recycle-bin"), fetch("/api/admin/attachments/cleanup")]); const auditBody = await auditResponse.json(), recycleBody = await recycleResponse.json(), cleanupBody = await cleanupResponse.json(); if (!auditResponse.ok || !recycleResponse.ok || !cleanupResponse.ok) throw new Error(auditBody.error || recycleBody.error || cleanupBody.error || "后台记录读取失败"); setLogs(auditBody.logs || []); setItems(recycleBody.items || []); setOrphanFiles(cleanupBody.attachments || []); } catch (error) { toast(error instanceof Error ? error.message : "后台记录读取失败"); } finally { setLoading(false); } }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- initial admin snapshot; actions explicitly reload it.
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, []);
  async function restore(item: (typeof items)[number]) { const response = await fetch("/api/admin/recycle-bin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: item.type, id: item.id }) }); const body = await response.json(); if (!response.ok) return toast(body.error || "恢复失败"); await load(); toast("内容已恢复，重新进入对应板块后可见。"); }
  async function cleanupAttachments() { if (!orphanFiles.length || !window.confirm(`确认清理 ${orphanFiles.length} 个超过 24 小时且没有活动内容引用的附件及全部历史版本？已删除文章若恢复，将不再包含这些附件。此操作不可恢复。`)) return; const response = await fetch("/api/admin/attachments/cleanup", { method: "POST" }); const body = await response.json(); if (!response.ok) return toast(body.error || "附件清理失败"); await load(); toast(`已清理 ${body.deleted || 0} 个孤儿附件`); }
  const actionLabels: Record<string, string> = { create: "创建", rename: "重命名", update: "更新", delete: "删除", restore: "恢复", cleanup: "清理", ban: "停用", unban: "启用", pause: "暂停", resume: "恢复", archive: "归档", complete: "完成", reopen: "重新打开", "reset-password": "重置密码", login: "登录" }; const entityLabels: Record<string, string> = { doc: "资料", "doc-category": "资料分类", sop: "SOP", "tracker-link": "跟踪链接", attachment: "附件", user: "账号", template: "模板", catalog: "品牌与产品", "organization-todo": "组织周期 Todo" };
  return <div className="audit-panel">{loading ? <div className="empty-state"><b>正在读取后台记录…</b></div> : <><section><h3>回收与附件 <span>{items.length + orphanFiles.length}</span></h3>{items.length ? <div className="recycle-list">{items.map((item) => <article key={`${item.type}-${item.id}`}><div><b>{item.title}</b><small>{{ doc: "通用资料", sop: "SOP 文档", "tracker-link": "跟踪链接" }[item.type]} · {formatTime(item.deletedAt)}</small></div><button onClick={() => restore(item)}><ActionIcon name="refresh" />恢复</button></article>)}</div> : <p className="muted">回收站为空</p>}<div className="attachment-cleanup"><div><b>孤儿附件扫描</b><small>{orphanFiles.length ? `${orphanFiles.length} 个文件 · ${formatBytes(orphanFiles.reduce((sum, file) => sum + file.size, 0))}` : "未发现可清理文件"}</small></div><div>{orphanFiles.length > 0 && <a href="/api/admin/attachments/download"><ActionIcon name="download" />批量下载</a>}<button disabled={!orphanFiles.length} onClick={cleanupAttachments}><ActionIcon name="delete" />安全清理</button></div></div>{orphanFiles.length > 0 && <div className="orphan-attachment-list">{orphanFiles.map((file) => <article key={file.id}><div><b>{file.title || file.name || "未命名附件"}</b><small>{file.reason}{file.brand ? ` · ${file.brand}${file.product ? ` / ${file.product}` : ""}` : ""}</small></div><span>{formatBytes(file.size)}</span></article>)}</div>}</section><section><h3>最近操作 <span>{logs.length}</span></h3><div className="audit-list readable">{logs.map((log) => <article key={log.id}><time>{formatTime(log.createdAt)}</time><div><b>{log.actorName || "系统"} · {actionLabels[log.action] || log.action}{entityLabels[log.entityType] || log.entityType}</b><small>{log.detail || "—"}</small></div></article>)}</div></section></>}</div>;
}

function IconPicker({ value, onChange, compact = false }: { value: string; onChange: (value: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false); const [uploading, setUploading] = useState(false);
  async function uploadIcon(file: File) { setUploading(true); try { const form = new FormData(); form.set("scope", "catalog-icon"); form.set("file", file); const response = await fetch("/api/workspace-attachments", { method: "POST", body: form }); const body = await response.json(); if (!response.ok || !body.attachment?.url) throw new Error(body.error || "图标上传失败"); onChange(`custom:${body.attachment.url}`); setOpen(false); } catch (error) { window.alert(error instanceof Error ? error.message : "图标上传失败"); } finally { setUploading(false); } }
  return <div className={`icon-picker ${compact ? "compact" : ""}`}><button type="button" className="icon-picker-trigger" title="更换图标" onClick={() => setOpen(!open)}><WorkspaceIcon name={value} />{!compact && <span>选择图标</span>}</button>{open && <div className="icon-popover">{iconChoices.map((name) => <button type="button" className={value === name ? "active" : ""} title={name} onClick={() => { onChange(name); setOpen(false); }} key={name}><WorkspaceIcon name={name} /></button>)}<label className="icon-upload" title="上传自定义图标"><ActionIcon name="uploadImage" /><span>{uploading ? "上传中" : "上传"}</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadIcon(file); }} /></label></div>}</div>;
}

function PersonalSettings({ profile, onSaved, onClose }: { profile: UserRecord; onSaved: (name: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"profile" | "password">("profile"); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  async function saveProfile(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget); const name = String(form.get("name") || ""); const response = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); const body = await response.json(); setBusy(false); setNotice(response.ok ? "个人资料已保存。" : body.error); if (response.ok) onSaved(name.trim()); }
  async function changePassword(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const currentPassword = String(form.get("currentPassword") || ""), newPassword = String(form.get("newPassword") || ""), confirm = String(form.get("confirm") || ""); if (newPassword !== confirm) return setNotice("两次输入的新密码不一致。"); setBusy(true); const response = await fetch("/api/profile/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) }); const body = await response.json(); setBusy(false); setNotice(response.ok ? "密码已修改，其它设备的登录已失效。" : body.error); if (response.ok) event.currentTarget.reset(); }
  return <div className="modal-backdrop"><section className="modal settings-modal"><header><div><span>PERSONAL SETTINGS</span><h2>{t("settings")}</h2><p>{t("profile")} · {t("security")}</p></div><button onClick={onClose}>×</button></header><nav className="admin-tabs"><button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>{t("basicInfo")}</button><button className={tab === "password" ? "active" : ""} onClick={() => setTab("password")}>{t("passwordSettings")}</button></nav>{notice && <div className="inline-notice">{notice}</div>}{tab === "profile" ? <form className="settings-form" onSubmit={saveProfile}><label>{t("name")}<input name="name" defaultValue={profile.name} required minLength={2} maxLength={40} /></label><label>{t("username")}<input value={profile.email.split("@")[0]} readOnly /></label><label>{t("role")}<input value={{ admin: "管理员 / Admin", editor: "编辑人员 / Editor", viewer: "普通用户 / Viewer" }[profile.role]} readOnly /></label><button className="primary" disabled={busy}>{t("saveProfile")}</button></form> : <form className="settings-form" onSubmit={changePassword}><label>{t("currentPassword")}<input name="currentPassword" type="password" required autoComplete="current-password" /></label><label>{t("newPassword")}<input name="newPassword" type="password" minLength={8} required autoComplete="new-password" /></label><label>{t("confirmPassword")}<input name="confirm" type="password" minLength={8} required autoComplete="new-password" /></label><small>{t("passwordHint")}</small><button className="primary" disabled={busy}>{t("changePassword")}</button></form>}</section></div>;
}

function PermissionsDialog({ profile, data, onClose, embedded = false }: { profile: UserRecord; data: WorkspaceState; onClose?: () => void; embedded?: boolean }) {
  const [rows, setRows] = useState<UserRecord[]>([profile]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newScopes, setNewScopes] = useState<string[]>(["*"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/users"); const body = await response.json();
    if (!response.ok) throw new Error(body.error || "成员读取失败"); setRows(body.users);
  }
  useEffect(() => { const timer = window.setTimeout(() => { load().catch((reason) => setError(reason instanceof Error ? reason.message : "成员读取失败")); }, 0); return () => window.clearTimeout(timer); }, []);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    const response = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: form.get("username"), password: form.get("password"), name: form.get("name"), role: form.get("role"), scopes: newScopes }) });
    const body = await response.json(); setBusy(false); if (!response.ok) { setError(body.error || "账号创建失败"); return; }
    setAdding(false); setNewScopes(["*"]); await load();
  }

  async function updateMember(user: UserRecord) {
    setBusy(true); setError(""); const response = await fetch(`/api/users/${user.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(user) }); const body = await response.json(); setBusy(false); if (!response.ok) setError(body.error || "权限更新失败"); else await load();
    if (response.ok) setEditingId(null);
  }

  async function deleteMember(user: UserRecord) {
    if (!window.confirm(`确认删除账号“${user.name}”？`)) return; setBusy(true); setError(""); const response = await fetch(`/api/users/${user.id}`, { method: "DELETE" }); const body = await response.json(); setBusy(false); if (!response.ok) setError(body.error || "账号删除失败"); else await load();
  }

  function change(id: string, patch: Partial<UserRecord>) { setRows((current) => current.map((user) => user.id === id ? { ...user, ...patch } : user)); }

  async function accountAction(user: UserRecord, action: "reset-password" | "ban" | "unban") { let password = ""; if (action === "reset-password") { password = window.prompt(`为“${user.name}”设置新密码（至少 8 位）`) || ""; if (!password) return; } if (action === "ban" && !window.confirm(`确认停用“${user.name}”？停用后该账号将无法登录。`)) return; setBusy(true); const response = await fetch(`/api/users/${user.id}/lifecycle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, password }) }); const body = await response.json(); setBusy(false); if (!response.ok) return setError(body.error || "账号操作失败"); await load(); setEditingId(null); }
  const panel = <div className={`permissions-modal ${embedded ? "embedded" : "modal"}`}>{!embedded && <header><div><span>ACCESS CONTROL</span><h2>账号与权限</h2><p>管理员创建账号，并按稳定的品牌 / 产品标识授权。</p></div><button className="icon-button" title="关闭" onClick={onClose}><ActionIcon name="close" /></button></header>}{error && <div className="form-error">{error}</div>}<div className="permission-summary"><div><b>{rows.length}</b><span>成员</span></div><div><b>{rows.filter((user) => user.role === "editor").length}</b><span>编辑人员</span></div><div><b>{rows.filter((user) => user.role === "admin").length}</b><span>管理员</span></div><button onClick={() => setAdding(!adding)}><ActionIcon name="add" />添加成员</button></div>{adding && <form className="member-form" onSubmit={addMember}><label>显示名称<input name="name" required placeholder="例如：内容编辑" /></label><label>登录账号<input name="username" required minLength={3} maxLength={30} placeholder="editor" /></label><label>初始密码<input name="password" required minLength={8} type="password" placeholder="至少 8 位" /></label><label>角色<select name="role" defaultValue="viewer"><option value="viewer">普通用户</option><option value="editor">编辑人员</option><option value="admin">管理员</option></select></label><div className="member-scope"><b>授权范围</b><ScopeSelector data={data} value={newScopes} onChange={setNewScopes} /></div><div><button type="button" onClick={() => setAdding(false)}>取消</button><button className="primary" disabled={busy}>创建账号</button></div></form>}<div className="permission-table"><div className="table-head"><span>成员</span><span>角色</span><span>授权范围</span><span>操作</span></div>{rows.map((user) => { const editing = editingId === user.id; return <div className={`table-row ${editing ? "editing" : ""}`} key={user.id}><span><i>{initials(user.name)}</i><b>{user.name}<small>{user.email.split("@")[0]} · {user.banned ? "已停用" : "正常"}</small></b></span><span>{editing ? <select value={user.role} disabled={user.id === profile.id} onChange={(event) => change(user.id, { role: event.target.value as Role })}><option value="admin">管理员</option><option value="editor">编辑人员</option><option value="viewer">普通用户</option></select> : <b>{{ admin: "管理员", editor: "编辑人员", viewer: "普通用户" }[user.role]}</b>}</span><span>{editing ? <ScopeSelector data={data} value={user.scopes} disabled={user.id === profile.id} onChange={(scopes) => change(user.id, { scopes })} /> : <small className="scope-summary">{describeWorkspaceScopes(data, user.scopes)}</small>}</span><span className="row-actions">{editing ? <><button className="primary" disabled={busy} onClick={() => updateMember(user)}><ActionIcon name="save" />保存</button><button disabled={busy} onClick={() => { setEditingId(null); void load(); }}>取消</button>{user.id !== profile.id && <><button disabled={busy} onClick={() => accountAction(user, "reset-password")}>重置密码</button><button className={user.banned ? "enable" : "danger-action"} disabled={busy} onClick={() => accountAction(user, user.banned ? "unban" : "ban")}>{user.banned ? "启用" : "停用"}</button><button className="danger-action" disabled={busy} onClick={() => deleteMember(user)}><ActionIcon name="delete" />删除</button></>}</> : <button disabled={busy} onClick={() => setEditingId(user.id)}><ActionIcon name="edit" />修改</button>}</span></div>; })}</div><footer><small>品牌勾选代表该品牌全部产品；取消品牌勾选后，可逐项勾选产品线。</small>{!embedded && <button className="primary" onClick={onClose}>完成</button>}</footer></div>;
  return embedded ? panel : <div className="modal-backdrop">{panel}</div>;
}

function ScopeSelector({ data, value, onChange, disabled = false }: { data: WorkspaceState; value: string[]; onChange: (value: string[]) => void; disabled?: boolean }) {
  const all = value.includes("*");
  function toggle(scope: string, checked: boolean) { const next = checked ? [...value.filter((item) => item !== "*"), scope] : value.filter((item) => item !== scope); onChange([...new Set(next)]); }
  return <div className="scope-selector"><label className="scope-all"><input type="checkbox" checked={all} disabled={disabled} onChange={(event) => onChange(event.target.checked ? ["*"] : [])} /> 全部品牌与产品</label><div className={all ? "scope-tree disabled" : "scope-tree"}>{data.brands.map((brand) => { const brandValue = brandScope(data, brand); const brandChecked = value.includes(brandValue); return <section key={data.brandIds[brand]}><label><input type="checkbox" checked={brandChecked} disabled={disabled || all} onChange={(event) => toggle(brandValue, event.target.checked)} /><b>{brand}</b></label><div>{(data.productsByBrand[brand] || []).map((product) => { const productValue = productScope(data, brand, product); return <label key={data.productIds[`${brand}/${product}`]}><input type="checkbox" checked={brandChecked || value.includes(productValue)} disabled={disabled || all || brandChecked} onChange={(event) => toggle(productValue, event.target.checked)} />{product}</label>; })}</div></section>; })}</div></div>;
}
