"use client";

import { useEffect, useState } from "react";
import { ActionIcon, WorkspaceIcon } from "../lib/workspace-icons";
import { KnowledgeMarkdown } from "./KnowledgeMarkdown";
import type { KnowledgeAttachment } from "./KnowledgeDocumentEditorDialog";

function formatBytes(size: number | null | undefined) {
  if (!size) return "";
  return size < 1024 * 1024 ? `${Math.max(1, Math.ceil(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function KnowledgeAttachmentLibrary({ scope, brand = "", product = "", documentId = "", libraryLabel = "通用资料与规章制度", currentIds, toast }: {
  scope: "doc" | "other-doc" | "sop";
  brand?: string;
  product?: string;
  documentId?: string;
  libraryLabel?: string;
  currentIds: string[];
  toast: (message: string) => void;
}) {
  const [attachments, setAttachments] = useState<KnowledgeAttachment[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copyId, setCopyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ scope, documentId }); if (brand) params.set("brand", brand); if (product) params.set("product", product);
    try {
      const response = await fetch(`/api/workspace-attachments?${params}`), body = await response.json();
      if (!response.ok) throw new Error(body.error || "资料与附件库读取失败");
      setAttachments(body.attachments || []);
    } catch (error) { toast(error instanceof Error ? error.message : "资料与附件库读取失败"); }
    finally { setLoading(false); }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- scope keys define the resource library; load is recreated with the same keys.
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [scope, brand, product, documentId]);

  async function copyContent(attachment: KnowledgeAttachment) {
    if (!attachment.content?.trim()) return;
    try {
      await navigator.clipboard.writeText(attachment.content); setCopyId(attachment.id);
      window.setTimeout(() => setCopyId(null), 1400);
    } catch { toast("浏览器未授权自动复制，请展开预览后手动选择文本"); }
  }

  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const current = new Set(currentIds);
  const visible = attachments.filter((item) => !normalizedQuery || [item.title || "", item.summary || "", item.content || "", item.name].join(" ").toLocaleLowerCase("zh-CN").includes(normalizedQuery));
  const scopeDescription = scope === "sop" ? `${brand} · ${product} 当前文章的资料与附件` : `${libraryLabel}当前文章的资料与附件`;
  return <section className="knowledge-attachment-library">
    <header className="resource-library-header"><div className="resource-library-identity"><span><WorkspaceIcon name="templates" /></span><div><h2>附件和模板库</h2><p>{scopeDescription}，支持文本预览复制与附件下载。</p></div></div><div className="resource-library-actions"><label><ActionIcon name="search" /><input value={query} placeholder="搜索名称、说明或正文" onChange={(event) => setQuery(event.target.value)} /></label></div></header>
    {loading ? <div className="doc-attachment-empty">正在读取附件和模板库…</div> : visible.length ? <div className="knowledge-attachment-grid resource-template-grid">{visible.map((attachment) => {
      const hasContent = Boolean(attachment.content?.trim()), hasAttachment = attachment.hasAttachment !== false && Boolean(attachment.name && attachment.size > 0);
      return <article id={`knowledge-asset-${attachment.id}`} className="resource-template-card" key={attachment.id}>
        <div className="asset-card-icon"><WorkspaceIcon name={hasContent ? "templates" : "docs"} /></div>
        <div className="resource-template-identity"><span>{current.has(attachment.id) ? "当前文档引用" : `${attachment.referenceCount || 0} 篇文章引用`}{hasAttachment ? ` · v${attachment.version || 1}` : " · 纯文本"}</span><h3 title={attachment.title || attachment.name}>{attachment.title || attachment.name}</h3><p>{attachment.summary || (hasContent ? "可预览并复制的文本资料" : "共享附件资料")}</p></div>
        {hasAttachment && <div className="resource-attachment-line"><ActionIcon name="open" /><div><b>{attachment.name}</b><small>{formatBytes(attachment.size)} · {attachment.type || "未知类型"}</small></div></div>}
        {expandedId === attachment.id && hasContent && <div className="template-preview resource-template-preview"><KnowledgeMarkdown className="template-preview-content ionic-doc-theme" markdown={attachment.content || ""} /></div>}
        <footer>{hasContent && <button type="button" onClick={() => setExpandedId(expandedId === attachment.id ? null : attachment.id)}><ActionIcon name={expandedId === attachment.id ? "hide" : "show"} />{expandedId === attachment.id ? "收起" : "预览"}</button>}{hasContent && <button type="button" onClick={() => void copyContent(attachment)}><ActionIcon name={copyId === attachment.id ? "check" : "copy"} />{copyId === attachment.id ? "已复制" : "复制文本"}</button>}{hasAttachment && <a href={attachment.url} download><ActionIcon name="download" />下载附件</a>}</footer>
      </article>;
    })}</div> : <div className="doc-attachment-empty">附件和模板库暂无匹配内容</div>}
  </section>;
}
