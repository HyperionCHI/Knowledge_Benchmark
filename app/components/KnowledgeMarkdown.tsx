"use client";
/* eslint-disable @next/next/no-img-element -- article images and attachment URLs are dynamic user content. */

import { Children, isValidElement, memo, useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkDirective from "remark-directive";
import rehypeKatex from "rehype-katex";
import { normalizeCherryBlocks, remarkCherryBlocks } from "../lib/cherry-markdown-syntax";

export type MarkdownAttachment = { id: string; name: string; type: string; size: number; url: string };

type MediaPreview =
  | { kind: "image"; label: string; src: string }
  | { kind: "mermaid"; label: string; svg: string };

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  data?: { hName?: string; hProperties?: Record<string, unknown> };
  children?: MarkdownNode[];
};

const calloutLabels: Record<string, string> = {
  note: "说明", abstract: "摘要", info: "信息", todo: "待办", tip: "提示", success: "完成",
  question: "问题", warning: "注意", failure: "失败", danger: "危险", bug: "问题", example: "示例", quote: "引用",
};
const mermaidStart = /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|sankey-beta|xychart-beta|block-beta|architecture-beta|packet-beta|kanban)\b/i;
let mermaidLoader: Promise<typeof import("mermaid")["default"]> | null = null;
let mermaidSequence = 0;
let mermaidRenderQueue: Promise<void> = Promise.resolve();

function loadMermaid() {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral", suppressErrorRendering: true });
      return mermaid;
    });
  }
  return mermaidLoader;
}
function renderMermaid(id: string, source: string) {
  const task = mermaidRenderQueue.then(async () => {
    const mermaid = await loadMermaid();
    return mermaid.render(id, source);
  });
  mermaidRenderQueue = task.then(() => undefined, () => undefined);
  return task;
}

function parseObsidianTarget(raw: string) {
  const [destination, label] = raw.split("|", 2);
  return { destination: destination.trim(), label: (label || destination).trim() };
}

function transformInlineObsidian(parent: MarkdownNode) {
  if (!parent.children || parent.type === "link") return;
  const next: MarkdownNode[] = [];
  for (const child of parent.children) {
    if (child.type !== "text" || !child.value) {
      transformInlineObsidian(child);
      next.push(child);
      continue;
    }
    const pattern = /(!?)\[\[([^\]\n]+)\]\]/g;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(child.value))) {
      if (match.index > cursor) next.push({ type: "text", value: child.value.slice(cursor, match.index) });
      const { destination, label } = parseObsidianTarget(match[2]);
      if (match[1]) next.push({ type: "image", url: "#obsidian-embed=" + encodeURIComponent(destination), alt: label });
      else next.push({ type: "link", url: "#obsidian-wiki=" + encodeURIComponent(destination), children: [{ type: "text", value: label }] });
      cursor = match.index + match[0].length;
    }
    if (cursor === 0) next.push(child);
    else if (cursor < child.value.length) next.push({ type: "text", value: child.value.slice(cursor) });
  }
  parent.children = next;
}

function transformCallout(node: MarkdownNode) {
  if (node.type !== "blockquote" || !node.children?.length) return;
  const first = node.children[0];
  const firstText = first.type === "paragraph" ? first.children?.find((child) => child.type === "text" && child.value) : undefined;
  const firstValue = firstText?.value || "";
  const match = firstValue.match(/^\[!([A-Za-z-]+)\][+-]?[ \t]*([^\n]*)(?:\n|$)/);
  if (!firstText || !match) return;
  const kind = match[1].toLowerCase();
  const title = match[2].trim() || calloutLabels[kind] || match[1];
  firstText.value = firstValue.slice(match[0].length);
  first.children = first.children?.filter((child) => child !== firstText || Boolean(child.value));
  if (!first.children?.length) node.children.shift();
  node.children.unshift({ type: "paragraph", children: [{ type: "strong", children: [{ type: "text", value: title }] }] });
  node.data = { hName: "aside", hProperties: { className: ["obsidian-callout", "obsidian-callout-" + kind], "data-callout": kind } };
}

function remarkObsidian() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      transformCallout(node);
      transformInlineObsidian(node);
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

function remarkSoftBreaks() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || !child.value || !/[\r\n]/.test(child.value)) return [child];
        return child.value.split(/\r\n?|\n/).flatMap((value, index, lines) => [
          ...(value ? [{ type: "text", value }] : []),
          ...(index < lines.length - 1 ? [{ type: "break" }] : []),
        ]);
      });
      node.children.forEach(visit);
    };
    visit(tree);
  };
}

function normalizedEmbedName(value: string) {
  return value.split("#", 1)[0].replaceAll("\\", "/").split("/").pop()?.trim().toLocaleLowerCase() || "";
}

function deferUntilIdle(callback: () => void) {
  const idleWindow = window as Window & {
    requestIdleCallback?: (task: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 1200 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(callback, 80);
  return () => window.clearTimeout(handle);
}

export function extractObsidianEmbedNames(markdown: string) {
  const fence = String.fromCharCode(96).repeat(3);
  const withoutFences = markdown.replace(new RegExp(fence + "[\\s\\S]*?" + fence, "g"), "");
  return [...withoutFences.matchAll(/!\[\[([^\]\n]+)\]\]/g)]
    .map((match) => normalizedEmbedName(parseObsidianTarget(match[1]).destination))
    .filter(Boolean);
}

function MediaLightbox({ preview, onClose }: { preview: MediaPreview; onClose: () => void }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      previousFocus?.focus();
    };
  }, [onClose]);
  return <div className="markdown-media-lightbox" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <button className="markdown-media-lightbox-backdrop" type="button" tabIndex={-1} aria-label="关闭放大预览" onClick={onClose} />
    <header><strong id={titleId}>{preview.label}</strong><span>按 Esc 或点击空白区域关闭</span><button ref={closeRef} type="button" aria-label="关闭放大预览" onClick={onClose}>×</button></header>
    <div className={`markdown-media-lightbox-content ${preview.kind}`}>
      {preview.kind === "image" ? <img src={preview.src} alt={preview.label} /> : <div className="markdown-media-lightbox-mermaid" dangerouslySetInnerHTML={{ __html: preview.svg }} />}
    </div>
  </div>;
}

function ZoomableImage({ src, alt, title, className, onPreview }: { src: string; alt: string; title?: string; className?: string; onPreview: (preview: MediaPreview) => void }) {
  const label = title || alt || "图片";
  const openPreview = () => onPreview({ kind: "image", label, src });
  return <button className="markdown-image-zoom-trigger" type="button" aria-label={`放大查看图片：${label}`} onClick={(event) => {
    event.preventDefault();
    event.stopPropagation();
    openPreview();
  }}><img src={src} alt={alt} title={title} className={className} /><span className="markdown-media-zoom-hint" aria-hidden="true">点击放大</span></button>;
}

function MermaidDiagram({ source, onPreview }: { source: string; onPreview: (preview: MediaPreview) => void }) {
  const stableId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const mountRef = useRef<HTMLElement | null>(null);
  const captureMount = useCallback((node: HTMLElement | null) => { mountRef.current = node; }, []);
  const [ready, setReady] = useState(false);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const node = mountRef.current;
    if (!node) return;
    let cancelReady: (() => void) | undefined;
    const activate = () => { cancelReady = deferUntilIdle(() => setReady(true)); };
    if (typeof IntersectionObserver === "undefined") {
      activate();
      return () => cancelReady?.();
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      activate();
    }, { rootMargin: "80px 0px" });
    observer.observe(node);
    return () => { observer.disconnect(); cancelReady?.(); };
  }, []);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const id = "knowledge-mermaid-" + stableId + "-" + (++mermaidSequence);
    void renderMermaid(id, source).then((rendered) => {
      if (active) setSvg(rendered.svg);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Mermaid 图表解析失败");
    });
    return () => { active = false; };
  }, [ready, source, stableId]);
  if (error) return <figure ref={captureMount} className="mermaid-diagram mermaid-error"><figcaption>流程图无法解析：{error}</figcaption><pre><code>{source}</code></pre></figure>;
  if (!svg) return <figure ref={captureMount} className="mermaid-diagram mermaid-loading">{ready ? "正在生成流程图…" : "流程图将在接近阅读位置时生成"}</figure>;
  return <button ref={captureMount} type="button" className="mermaid-diagram mermaid-zoom-trigger" aria-label="放大查看 Mermaid 图表" onClick={() => onPreview({ kind: "mermaid", label: "Mermaid 图表", svg })}><span className="mermaid-rendered-svg" dangerouslySetInnerHTML={{ __html: svg }} /><span className="markdown-media-zoom-hint" aria-hidden="true">点击放大</span></button>;
}
function decodeHashValue(href: string, prefix: string) {
  try { return decodeURIComponent(href.slice(prefix.length)); } catch { return href.slice(prefix.length); }
}

function sameAttachments(left: MarkdownAttachment[] | undefined, right: MarkdownAttachment[] | undefined) {
  const previous = left || [], next = right || [];
  return previous.length === next.length && previous.every((item, index) => {
    const candidate = next[index];
    return item.id === candidate.id && item.name === candidate.name && item.type === candidate.type && item.size === candidate.size && item.url === candidate.url;
  });
}

export const KnowledgeMarkdown = memo(function KnowledgeMarkdown({ markdown, attachments = [], className = "", wrapContent = false }: { markdown: string; attachments?: MarkdownAttachment[]; className?: string; wrapContent?: boolean }) {
  const [preview, setPreview] = useState<MediaPreview | null>(null);
  const closePreview = useCallback(() => setPreview(null), []);
  const components: Components = {
    pre({ children }) {
      const only = Children.count(children) === 1 && isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : null;
      const source = only ? String(only.props.children || "").replace(/\n$/, "") : "";
      const language = only?.props.className || "";
      if (source && (/language-mermaid\b/i.test(language) || (!language && mermaidStart.test(source.trimStart())))) return <MermaidDiagram key={source} source={source} onPreview={setPreview} />;
      return <pre>{children}</pre>;
    },
    a({ href = "", children, title, className: linkClassName, node }) {
      if (node?.children.length === 1 && node.children[0].type === "element" && node.children[0].tagName === "img") return <>{children}</>;
      if (href.startsWith("#obsidian-wiki=")) {
        const target = decodeHashValue(href, "#obsidian-wiki=");
        return <a href={href} className={"obsidian-wiki-link " + (linkClassName || "")} title={title} onClick={(event) => {
          event.preventDefault();
          window.dispatchEvent(new CustomEvent("workspace-wiki-link", { detail: target }));
        }}>{children}</a>;
      }
      return <a href={href} title={title} className={linkClassName}>{children}</a>;
    },
    img({ src = "", alt = "", title, className: imageClassName }) {
      const source = typeof src === "string" ? src : "";
      if (source.startsWith("#obsidian-embed=")) {
        const target = decodeHashValue(source, "#obsidian-embed=");
        const name = normalizedEmbedName(target);
        const attachment = attachments.find((item) => normalizedEmbedName(item.name) === name);
        if (!attachment) return <span className="obsidian-embed-missing">未找到 Obsidian 嵌入：{target}</span>;
        if (attachment.type.startsWith("image/") || /\.(?:png|jpe?g|gif|webp|svg)$/i.test(attachment.name)) {
          return <ZoomableImage src={attachment.url} alt={alt || attachment.name} title={title} className={imageClassName} onPreview={setPreview} />;
        }
        return <a className="obsidian-attachment-embed" href={attachment.url} target="_blank" rel="noreferrer">下载附件：{attachment.name}</a>;
      }
      return <ZoomableImage src={source} alt={alt} title={title} className={imageClassName} onPreview={setPreview} />;
    },
    aside({ children, className: asideClassName }) {
      return <aside className={asideClassName}>{children}</aside>;
    },
  };
  const content = <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkDirective, remarkCherryBlocks, remarkObsidian, remarkSoftBreaks]} rehypePlugins={[[rehypeKatex, { trust: false, strict: "ignore" }]]} components={components}>{normalizeCherryBlocks(markdown)}</ReactMarkdown>;
  return <><div className={className}>{wrapContent ? <div className="knowledge-editor-preview-content">{content}</div> : content}</div>{preview && createPortal(<MediaLightbox preview={preview} onClose={closePreview} />, document.body)}</>;
}, (previous, next) => previous.markdown === next.markdown && previous.className === next.className && previous.wrapContent === next.wrapContent && sameAttachments(previous.attachments, next.attachments));
