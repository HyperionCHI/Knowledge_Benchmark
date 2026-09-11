import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { KnowledgeMarkdown } from "../app/components/KnowledgeMarkdown";

function render(markdown: string) {
  return renderToStaticMarkup(createElement(KnowledgeMarkdown, { markdown }));
}

test("renders a single line ending as a hard line break", () => {
  const html = render("第一行\n第二行");

  assert.match(html, /<p>第一行<br\/>\n第二行<\/p>/);
});

test("normalizes a Windows line ending to a hard line break", () => {
  const html = render("第一行\r\n第二行");

  assert.match(html, /<p>第一行<br\/>\n第二行<\/p>/);
});

test("normalizes a carriage return to a hard line break", () => {
  const html = render("第一行\r第二行");

  assert.match(html, /<p>第一行<br\/>\n第二行<\/p>/);
});

test("keeps a blank line as a paragraph boundary", () => {
  const html = render("第一段\n\n第二段");

  assert.match(html, /<p>第一段<\/p>\n<p>第二段<\/p>/);
  assert.doesNotMatch(html, /<br\/>/);
});

test("does not add an extra break after an Obsidian callout title", () => {
  const html = render("> [!NOTE] 标题\n> 正文");

  assert.match(html, /<aside[^>]*>\n<p><strong>标题<\/strong><\/p>\n<p>正文<\/p>\n<\/aside>/);
  assert.doesNotMatch(html, /<strong>标题<\/strong><br\/>/);
});

test("renders Markdown images as native zoom buttons", () => {
  const html = render("![示例图片](https://example.test/example.png)");

  assert.match(html, /<button class="markdown-image-zoom-trigger" type="button" aria-label="放大查看图片：示例图片"/);
  assert.match(html, /<img src="https:\/\/example\.test\/example\.png" alt="示例图片"/);
});

test("does not nest an image zoom button inside a Markdown link", () => {
  const html = render("[![链接图片](https://example.test/example.png)](https://example.test/target)");

  assert.match(html, /<button class="markdown-image-zoom-trigger"/);
  assert.doesNotMatch(html, /<a[^>]*><button/);
});

test("renders Cherry formulas, panels and folding blocks in the shared preview", () => {
  assert.match(render("$$\nx^2\n$$"), /class="katex/);
  const panel = render("::: warning 注意\n**正文**\n:::");
  assert.match(panel, /knowledge-panel-warning/);
  assert.match(panel, /<strong>正文<\/strong>/);
  const details = render("+++ 标题\n折叠正文\n+++");
  assert.match(details, /<details/);
  assert.match(details, /<summary>标题<\/summary>/);
  assert.match(details, /折叠正文/);
});

test("keeps Cherry syntax literal in code blocks and does not allow directive HTML injection", () => {
  const code = render("```text\n::: warning 注意\n+++ 折叠\n``` ");
  assert.doesNotMatch(code, /knowledge-panel|<details/);
  assert.match(code, /::: warning/);
  const attack = render(':::script{src="https://example.test/evil.js"}\n恶意内容\n:::');
  assert.doesNotMatch(attack, /<script/);
});

test("renders nested panels and keeps content in column layouts", () => {
  const nested = render("::: warning 外层\n\n::: info 内层\n内文\n:::\n\n:::");
  assert.match(nested, /knowledge-panel-warning/);
  assert.match(nested, /knowledge-panel-info/);
  const columns = render("::: 2cols\n第一列\n::\n第二列\n:::");
  assert.match(columns, /knowledge-panel-2cols/);
  assert.match(columns, /第一列/);
  assert.match(columns, /第二列/);
});
