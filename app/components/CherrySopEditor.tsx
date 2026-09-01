"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import "cherry-markdown/dist/cherry-markdown.css";
import type CherryType from "cherry-markdown";
import { KnowledgeMarkdown, type MarkdownAttachment } from "./KnowledgeMarkdown";

function syncScrollPosition(source: HTMLElement, target: HTMLElement) {
  const sourceRange = source.scrollHeight - source.clientHeight;
  const targetRange = target.scrollHeight - target.clientHeight;
  const progress = sourceRange > 0 ? source.scrollTop / sourceRange : 0;
  target.scrollTop = progress * Math.max(targetRange, 0);
}

export type CherrySopEditorHandle = {
  insertAtCursor: (markdown: string) => void;
};

export const CherrySopEditor = forwardRef<CherrySopEditorHandle, { value: string; onChange: (value: string) => void; onImageUpload: (file: File) => Promise<{ url: string; name: string } | null>; attachments?: MarkdownAttachment[] }>(function CherrySopEditor({ value, onChange, onImageUpload, attachments = [] }, ref) {
  const mountRef = useRef<HTMLDivElement>(null); const previewSectionRef = useRef<HTMLElement>(null); const instanceRef = useRef<CherryType | null>(null); const onChangeRef = useRef(onChange); const onImageUploadRef = useRef(onImageUpload); const initialValueRef = useRef(value); const syncPreviewScrollRef = useRef<(() => void) | null>(null);
  useEffect(() => { onChangeRef.current = onChange; onImageUploadRef.current = onImageUpload; }, [onChange, onImageUpload]);
  useEffect(() => {
    let disposed = false;
    let removeScrollSync: (() => void) | undefined;
    import("cherry-markdown").then(({ default: Cherry }) => {
      if (disposed || !mountRef.current) return;
      const instance = new Cherry({
        el: mountRef.current,
        value: initialValueRef.current,
        locale: "zh_CN",
        engine: { syntax: { table: { enableChart: false } } },
        editor: { defaultModel: "editOnly", height: "560px", convertWhenPaste: false, keepDocumentScrollAfterInit: true },
        toolbars: { toc: false, toolbar: ["bold", "italic", "strikethrough", "|", "header", "list", "panel", "justify", "detail", "formula", "graph", "image", "link", "code", "table"] },
        callback: {
          afterChange: (markdown) => onChangeRef.current(markdown),
          fileUpload: (file, callback) => { onImageUploadRef.current(file).then((result) => { if (result) callback(result.url, { name: result.name, isRadius: true }); }); },
        },
      });
      instanceRef.current = instance;
      const editorScroll = instance.getCodeMirror().scrollDOM;
      const previewScroll = previewSectionRef.current?.querySelector<HTMLElement>(".knowledge-editor-preview");
      if (!previewScroll) return;
      let ignoredScrollTarget: HTMLElement | null = null;
      let releaseFrame = 0;
      const connect = (source: HTMLElement, target: HTMLElement) => () => {
        if (ignoredScrollTarget === source) return;
        ignoredScrollTarget = target;
        syncScrollPosition(source, target);
        window.cancelAnimationFrame(releaseFrame);
        releaseFrame = window.requestAnimationFrame(() => { ignoredScrollTarget = null; });
      };
      const syncPreviewScroll = connect(editorScroll, previewScroll);
      const syncEditorScroll = connect(previewScroll, editorScroll);
      syncPreviewScrollRef.current = syncPreviewScroll;
      editorScroll.addEventListener("scroll", syncPreviewScroll, { passive: true });
      previewScroll.addEventListener("scroll", syncEditorScroll, { passive: true });
      syncPreviewScroll();
      removeScrollSync = () => {
        window.cancelAnimationFrame(releaseFrame);
        editorScroll.removeEventListener("scroll", syncPreviewScroll);
        previewScroll.removeEventListener("scroll", syncEditorScroll);
        syncPreviewScrollRef.current = null;
      };
    });
    return () => { disposed = true; removeScrollSync?.(); instanceRef.current?.destroy(); instanceRef.current = null; };
  }, []);
  useEffect(() => {
    const instance = instanceRef.current;
    if (instance && instance.getValue() !== value) instance.setValue(value, true);
    const frame = window.requestAnimationFrame(() => syncPreviewScrollRef.current?.());
    return () => window.cancelAnimationFrame(frame);
  }, [value]);
  useImperativeHandle(ref, () => ({
    insertAtCursor(markdown: string) {
      const instance = instanceRef.current;
      if (!instance) return;
      const editor = instance.getCodeMirror();
      const selection = editor.state.selection.main;
      const source = instance.getValue();
      const before = source.slice(0, selection.from), after = source.slice(selection.to);
      const prefix = before && !before.endsWith("\n") ? "\n" : "";
      const suffix = after && !after.startsWith("\n") ? "\n" : "";
      const insert = `${prefix}${markdown}${suffix}`;
      const anchor = selection.from + insert.length;
      editor.dispatch({ changes: { from: selection.from, to: selection.to, insert }, selection: { anchor } });
      editor.focus();
    },
  }), []);
  return <div className="knowledge-editor-layout">
    <section><b>Markdown 原文</b><div className="cherry-sop-editor ionic-editor-theme" ref={mountRef} /></section>
    <section ref={previewSectionRef}><b>统一预览</b><KnowledgeMarkdown markdown={value} attachments={attachments} className="knowledge-editor-preview ionic-doc-theme" /></section>
  </div>;
});
