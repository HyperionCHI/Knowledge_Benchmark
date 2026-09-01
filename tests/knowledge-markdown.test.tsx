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
