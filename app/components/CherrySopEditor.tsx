"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import "cherry-markdown/dist/cherry-markdown.css";
import type CherryType from "cherry-markdown";
import { connectEditorScroll } from "../lib/editor-scroll-sync";
import { KnowledgeMarkdown, type MarkdownAttachment } from "./KnowledgeMarkdown";

export type CherrySopEditorHandle = { insertAtCursor: (markdown: string) => void };

export const CherrySopEditor = forwardRef<CherrySopEditorHandle, {
  value: string;
  onChange: (value: string) => void;
  onImageUpload: (file: File) => Promise<{ url: string; name: string } | null>;
  attachments?: MarkdownAttachment[];
}>(function CherrySopEditor({ value, onChange, onImageUpload, attachments = [] }, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  const previewSectionRef = useRef<HTMLElement>(null);
  const instanceRef = useRef<CherryType | null>(null);
  const latest = useRef({ value, onChange, onImageUpload });
  const syncRef = useRef<ReturnType<typeof connectEditorScroll> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [pane, setPane] = useState<"source" | "preview">("source");

  useEffect(() => { latest.current = { value, onChange, onImageUpload }; }, [value, onChange, onImageUpload]);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError("");
    import("cherry-markdown").then(({ default: Cherry }) => {
      if (disposed || !mountRef.current) return;
      const instance = new Cherry({
        el: mountRef.current,
        value: latest.current.value,
        locale: "zh_CN",
        engine: { syntax: { table: { enableChart: false } } },
        // Cherry writes this value as an inline style on the mount element.
        editor: { defaultModel: "editOnly", height: "100%", convertWhenPaste: false, keepDocumentScrollAfterInit: true },
        toolbars: { toc: false, toolbar: ["bold", "italic", "strikethrough", "|", "header", "list", "panel", "justify", "detail", "formula", "graph", "image", "link", "code", "table"] },
        callback: {
          afterChange: (markdown) => { if (!disposed) latest.current.onChange(markdown); },
          fileUpload: (file, callback) => {
            latest.current.onImageUpload(file).then((result) => {
              if (!disposed && result) callback(result.url, { name: result.name, isRadius: true });
            }).catch(() => { if (!disposed) setError("图片上传失败，请重试。"); });
          },
        },
      });
      instanceRef.current = instance;
      const editorScroll = instance.getCodeMirror().scrollDOM;
      const previewScroll = previewSectionRef.current?.querySelector<HTMLElement>(".knowledge-editor-preview");
      if (previewScroll) syncRef.current = connectEditorScroll(editorScroll, previewScroll);
      setLoading(false);
    }).catch(() => {
      if (!disposed) { setError("编辑器加载失败，可继续使用下方文本框编辑，或重试加载。"); setLoading(false); }
    });
    return () => {
      disposed = true;
      syncRef.current?.destroy();
      syncRef.current = null;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [attempt]);
  useEffect(() => {
    const instance = instanceRef.current;
    if (instance && instance.getValue() !== value) instance.setValue(value, true);
    const frame = window.requestAnimationFrame(() => syncRef.current?.syncFromEditor());
    return () => window.cancelAnimationFrame(frame);
  }, [value]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      instanceRef.current?.getCodeMirror().requestMeasure();
      syncRef.current?.refresh();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pane]);
  useImperativeHandle(ref, () => ({
    insertAtCursor(markdown: string) {
      const instance = instanceRef.current;
      if (!instance) {
        const next = latest.current.value.trimEnd() + "\n\n" + markdown + "\n";
        latest.current = { ...latest.current, value: next };
        latest.current.onChange(next);
        return;
      }
      setPane("source");
      const editor = instance.getCodeMirror();
      const selection = editor.state.selection.main;
      const source = instance.getValue();
      const before = source.slice(0, selection.from), after = source.slice(selection.to);
      const prefix = before && !before.endsWith("\n") ? "\n" : "";
      const suffix = after && !after.startsWith("\n") ? "\n" : "";
      const insert = prefix + markdown + suffix;
      const anchor = selection.from + insert.length;
      editor.dispatch({ changes: { from: selection.from, to: selection.to, insert }, selection: { anchor }, scrollIntoView: true });
      editor.focus();
    },
  }), []);
  return <div className="knowledge-editor-layout" data-pane={pane}>
    <nav className="knowledge-editor-pane-switch" aria-label="编辑区域">
      <button type="button" aria-pressed={pane === "source"} onClick={() => setPane("source")}>Markdown 原文</button>
      <button type="button" aria-pressed={pane === "preview"} onClick={() => setPane("preview")}>统一预览</button>
    </nav>
    <section className="knowledge-editor-source"><b>Markdown 原文</b><div className="knowledge-editor-source-body">
      <div className="cherry-sop-editor ionic-editor-theme" ref={mountRef} />
      {(loading || (error && !instanceRef.current)) && <div className="knowledge-editor-fallback">
        <p role="status">{loading ? "正在加载编辑器，可先在下方输入正文…" : error}{!loading && <button type="button" onClick={() => setAttempt((current) => current + 1)}>重试</button>}</p>
        <textarea aria-label="Markdown 正文（基础编辑）" value={value} onChange={(event) => onChange(event.target.value)} />
      </div>}
      {error && instanceRef.current && <p className="knowledge-editor-error" role="alert">{error}<button type="button" onClick={() => setError("")}>关闭提示</button></p>}
    </div></section>
    <section className="knowledge-editor-preview-section" ref={previewSectionRef}><b>统一预览</b><KnowledgeMarkdown markdown={value} attachments={attachments} className="knowledge-editor-preview ionic-doc-theme" wrapContent /></section>
  </div>;
});
