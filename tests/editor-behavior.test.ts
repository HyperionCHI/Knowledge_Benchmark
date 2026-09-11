import assert from "node:assert/strict";
import test from "node:test";
import { connectEditorScroll } from "../app/lib/editor-scroll-sync";
import { editorDraftKey, parseEditorDraft } from "../app/lib/editor-draft";

class Scrollport extends EventTarget {
  scrollTop = 0;
  scrollHeight = 1000;
  clientHeight = 200;
  firstElementChild = null;
  element() { return this as unknown as HTMLElement; }
  scrollTo(top: number) { this.dispatchEvent(new Event("wheel")); this.scrollTop = top; this.dispatchEvent(new Event("scroll")); }
}

test("scroll sync reaches both ends, ignores delayed echoes, and follows either pane", () => {
  const source = new Scrollport(), preview = new Scrollport();
  preview.scrollHeight = 2200;
  const bridge = connectEditorScroll(source.element(), preview.element());
  source.scrollTo(799.5);
  assert.equal(preview.scrollTop, 2000);
  preview.dispatchEvent(new Event("scroll"));
  assert.equal(source.scrollTop, 799.5, "late programmatic event must not scroll source back");
  preview.scrollTo(1000);
  assert.equal(source.scrollTop, 400);
  source.dispatchEvent(new Event("scroll"));
  assert.equal(preview.scrollTop, 1000);
  preview.scrollTo(0);
  assert.equal(source.scrollTop, 0);
  // destroy() uses requestAnimationFrame's cancellation surface.
  const previous = globalThis.window;
  globalThis.window = { cancelAnimationFrame() {} } as unknown as Window & typeof globalThis;
  bridge.destroy();
  globalThis.window = previous;
  source.scrollTo(800);
  assert.equal(preview.scrollTop, 0, "listeners are removed on unmount");
});

test("preview image/diagram reflow preserves the end and hidden panes do not erase it", () => {
  const source = new Scrollport(), preview = new Scrollport();
  const previous = globalThis.window;
  globalThis.window = { cancelAnimationFrame() {}, requestAnimationFrame(callback: FrameRequestCallback) { callback(0); return 1; } } as unknown as Window & typeof globalThis;
  try {
    const bridge = connectEditorScroll(source.element(), preview.element());
    source.scrollTo(800);
    preview.scrollHeight = 2000;
    bridge.refresh();
    assert.equal(preview.scrollTop, 1800);
    preview.clientHeight = 0;
    bridge.refresh();
    assert.equal(preview.scrollTop, 1800);
    preview.clientHeight = 300;
    bridge.refresh();
    assert.equal(preview.scrollTop, 1700);
    bridge.destroy();
  } finally { globalThis.window = previous; }
});

test("drafts are isolated by user, scope, brand, product and document, including delimiter characters", () => {
  const keys = [editorDraftKey("alice", "sop", "A", "X"), editorDraftKey("bob", "sop", "A", "X"), editorDraftKey("alice", "sop", "B", "X"), editorDraftKey("alice", "sop", "A", "Y"), editorDraftKey("alice", "doc", "A", "X"), editorDraftKey("alice", "sop", "A", "X", "saved"), editorDraftKey("alice", "sop", "A:X", ""), editorDraftKey("alice", "sop", "A", "X:")];
  assert.equal(new Set(keys).size, keys.length);
});

test("draft parser rejects legacy text/corruption and preserves empty body and metadata", () => {
  assert.equal(parseEditorDraft("old markdown"), null);
  assert.equal(parseEditorDraft('{"title":"incomplete"}'), null);
  const draft = { title: "标题", group: "分类", body: "", attachmentIds: ["a"], pendingDeleteIds: [], status: "draft", treeIcon: "docs", treeIconColor: "#53617b", baseVersion: 3, savedAt: "2026-09-08T00:00:00Z" };
  assert.deepEqual(parseEditorDraft(JSON.stringify(draft)), draft);
  assert.equal(parseEditorDraft(JSON.stringify({ ...draft, attachmentIds: [123] })), null);
});
