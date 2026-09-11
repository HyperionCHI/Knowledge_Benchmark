import { useState } from "react";
import { createRoot } from "react-dom/client";
import { KnowledgeDocumentEditorDialog } from "../app/components/KnowledgeDocumentEditorDialog";
import "../app/globals.css";
import "katex/dist/katex.min.css";
import "../app/editor-layout.css";

function Fixture() {
  const [open, setOpen] = useState(true);
  const body = Array.from({ length: 160 }, (_, index) => `第 ${index + 1} 行：编辑器滚动回归测试。`).join("\n") + "\n\n最后一行：END-OF-DOCUMENT";
  return <><button type="button" onClick={() => setOpen(true)}>重新打开测试文章</button>{open && <KnowledgeDocumentEditorDialog
    record={{ id: "", title: "长文章测试", group: "测试", body, items: [], attachments: [], version: 1 }}
    categories={["测试"]} defaultCategory="测试" scope="doc" draftOwnerId="editor-regression-fixture"
    title="文章编辑器回归检查" saveLabel="完成检查" canManageCategories={false}
    onSave={async () => ({ id: "fixture-only" })} onEnsureDocument={async () => null}
    onClose={() => setOpen(false)} onCategoryAction={async () => false} toast={(message) => window.alert(message)}
  />}</>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
