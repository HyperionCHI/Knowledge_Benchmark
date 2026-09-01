import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("includes the six workspace modules and built-in login flow", async () => {
  const [workspace, auth, terminology] = await Promise.all([
    source("app/components/WorkspaceApp.tsx"),
    source("app/lib/auth.ts"),
    source("app/sections/terminology/terminology-data.json").then(JSON.parse),
  ]);

  for (const label of ["通用资料与规章制度", "品牌 / 产品 SOP", "项目跟踪表格索引", "其它资料", "行业术语库", "通用附件及模板"]) {
    assert.match(workspace, new RegExp(label.replaceAll("/", "\\/")));
  }
  assert.match(workspace, /初始化管理员账号/);
  assert.match(workspace, /账号与权限/);
  assert.match(workspace, /const COPYRIGHT_NOTICE = "Knowledge Workbench contributors\."/);
  assert.doesNotMatch(workspace, /Hyperion CHI/);
  assert.match(workspace, /console\.info\(COPYRIGHT_NOTICE\)/);
  assert.doesNotMatch(workspace, /<footer className="workspace-footer"/);
  const docsAndSopPages = workspace.slice(workspace.indexOf("function DocsPage"), workspace.indexOf("function AdminConsole"));
  const sopPage = workspace.slice(workspace.indexOf("function SopPage"), workspace.indexOf("function ProductTemplates"));
  const adminExport = workspace.slice(workspace.indexOf("function AdminExportPanel"), workspace.indexOf("function AuditPanel"));
  assert.doesNotMatch(docsAndSopPages, /knowledge-export|批量导出/);
  assert.match(adminExport, /knowledge-export\?kind=general/);
  assert.match(adminExport, /knowledge-export\?kind=sop/);
  const documentArticle = docsAndSopPages.slice(docsAndSopPages.indexOf('return <section className="docs-page"'), docsAndSopPages.indexOf('{structureOpen'));
  const structureManager = docsAndSopPages.slice(docsAndSopPages.indexOf('function structureCategory'), docsAndSopPages.indexOf('function formatBytes'));
  assert.match(workspace, /breadcrumb-action[\s\S]*编辑层级/);
  assert.match(documentArticle, /titleAction=\{documentCanEdit[\s\S]*aria-label="编辑文章"[\s\S]*<ActionIcon name="edit" \/>/);
  assert.doesNotMatch(documentArticle, /复制链接|页面链接已复制|<ActionIcon name="edit" \/>编辑文章/);
  assert.doesNotMatch(documentArticle, /如页面内容与最新正式制度不一致|如资料存在更新/);
  assert.doesNotMatch(documentArticle, /版本历史|确认删除文件/);
  for (const label of ["新建一级分类", "新建二级分类", "新建文件", "修改历史", "重命名", "删除"]) assert.match(structureManager, new RegExp(label));
  assert.match(workspace, /view: "sop-brands" as View/);
  assert.match(workspace, /view === "sop-brands"[\s\S]*BrandPicker/);
  assert.match(workspace, /view === "sop-products"[\s\S]*ProductPicker/);
  assert.ok(workspace.indexOf('{ view: "other-docs"') < workspace.indexOf('{ view: "terms"'), "其它资料应位于术语库之前");
  assert.match(workspace, /view === "other-docs"[\s\S]*<DocsPage kind="other"/);
  assert.match(workspace, /其它资料结构编辑/);
  assert.match(sopPage, /title="当前产品 SOP 目录"/);
  assert.match(sopPage, /SOP 结构编辑/);
  assert.doesNotMatch(sopPage, /data\.brands\.map|品牌、产品、分类与文档导航/);
  const sopArticle = sopPage.slice(sopPage.indexOf('return <section className="sop-page docs-page"'), sopPage.indexOf('{structureOpen'));
  assert.match(sopArticle, /titleAction=\{recordCanEdit[\s\S]*aria-label="编辑文章"[\s\S]*<ActionIcon name="edit" \/>/);
  assert.doesNotMatch(sopArticle, /复制链接|页面链接已复制|<ActionIcon name="edit" \/>编辑文章/);
  assert.doesNotMatch(sopArticle, /版本历史|确认删除文件/);
  assert.match(auth, /emailAndPassword:\s*\{\s*enabled:\s*true/);
  assert.match(auth, /username\(/);
  const authScreen = workspace.slice(workspace.indexOf("function AuthScreen"), workspace.indexOf("function Header"));
  assert.match(authScreen, /type="submit"/);
  assert.match(authScreen, /onKeyDown=\{submitOnEnter\}/);
  assert.match(authScreen, /requestSubmit\(\)/);
  assert.deepEqual(terminology.categories, [], "release copy should not bundle terminology categories");
  assert.deepEqual(terminology.terms, [], "release copy should not bundle terminology entries");
});

test("uses portable SQLite and local attachment storage", async () => {
  const [database, attachments, vite, packageJson] = await Promise.all([
    source("db/local.ts"),
    source("db/attachments.ts"),
    source("vite.config.ts"),
    source("package.json"),
  ]);
  assert.match(database, /better-sqlite3/);
  assert.match(database, /journal_mode = WAL/);
  assert.match(attachments, /WORKBENCH_ATTACHMENT_DIR/);
  assert.doesNotMatch(vite, /cloudflare/);
  assert.match(packageJson, /"better-auth"/);
  assert.match(packageJson, /"better-sqlite3"/);
});

test("keeps organization Todo management inside admin-only Todo settings with readable recurrence controls", async () => {
  const [workspace, personalTodo, organizationAdmin, styles] = await Promise.all([
    source("app/components/WorkspaceApp.tsx"),
    source("app/components/PersonalTodo.tsx"),
    source("app/components/OrganizationTodoAdmin.tsx"),
    source("app/globals.css"),
  ]);
  const adminConsole = workspace.slice(workspace.indexOf("function AdminConsole"), workspace.indexOf("function AdminExportPanel"));
  assert.doesNotMatch(adminConsole, /周期 Todo 管理|组织TODO管理|OrganizationTodoAdmin/);
  assert.match(workspace, /isAdmin=\{profile\.role === "admin"\}/);
  assert.match(personalTodo, /\{isAdmin && <button[\s\S]*?组织TODO管理<\/button>\}/);
  assert.match(personalTodo, /tab === "organization-admin" && isAdmin && <OrganizationTodoAdmin/);
  for (const wording of ["每隔几期重复", "下一期从何时开始计算", "错过日期后怎么处理", "最多生成多少期（选填）"]) assert.match(personalTodo, new RegExp(wording));
  assert.match(organizationAdmin, /<h3>组织TODO管理<\/h3>/);
  assert.match(styles, /personal-todo-weekdays\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(70px,1fr\)\)/);
  assert.match(styles, /personal-todo-editor>\.personal-todo-check[^}]*display:flex/);
  assert.match(styles, /personal-todo-weekdays input[^}]*width:14px;height:14px/);
  assert.match(styles, /Readable Todo type scale/);
  assert.match(styles, /personal-todo-quick-list>label,.personal-todo-quick-item\{font-size:12px\}/);
  assert.match(styles, /personal-todo-editor>label,.personal-todo-form-grid label,.personal-todo-temp-editor label\{font-size:12px\}/);
});

test("keeps the open product icon picker above neighboring admin cards", async () => {
  const styles = await source("app/globals.css");
  assert.match(styles, /product-admin-grid article:has\(\.icon-popover\)\{[^}]*z-index:30/);
  assert.doesNotMatch(styles, /\.workspace-footer/);
});

test("formats search results as section, optional brand and product, then full file name", async () => {
  const [route, workspace, styles] = await Promise.all([
    source("app/api/search/route.ts"),
    source("app/components/WorkspaceApp.tsx"),
    source("app/globals.css"),
  ]);
  for (const section of ["通用资料与规章制度", "其它资料", "品牌 / 产品 SOP", "项目跟踪表格索引", "行业术语库", "通用附件及模板"]) assert.match(route, new RegExp(section.replaceAll("/", "\\/")));
  assert.match(route, /\[section, brand, product, fileName\]\.filter/);
  assert.match(route, /\.join\("-"\)/);
  const searchDialog = workspace.slice(workspace.indexOf("function SearchDialog"), workspace.indexOf("function AdminConsole"));
  assert.match(searchDialog, /search-result-type search-result-/);
  assert.match(searchDialog, />\{result\.type\}<\/span><div><b>\{result\.title\}/);
  assert.match(styles, /search-results>button \{[^}]*grid-template-columns:48px minmax\(0,1fr\) auto/);
  assert.match(styles, /search-result-article \{[^}]*color:#1556a5;[^}]*background:#dcecff/);
  assert.match(styles, /search-result-attachment \{[^}]*color:#7d5900;[^}]*background:#ffefb5/);
  assert.match(styles, /search-result-term \{[^}]*color:#21683c;[^}]*background:#dff4e6/);
  assert.match(route, /type: "文章"/);
  assert.match(route, /type: "附件"/);
  assert.match(route, /type: "术语"/);
  assert.match(route, /FROM workspace_attachments WHERE scope IN \('doc', 'other-doc', 'sop'\)/);
  assert.match(route, /name LIKE \? ESCAPE/);
  assert.match(route, /knowledgeDocumentPermission\(access\.state, access\.profile, document\)\.canView/);
  assert.match(route, /url: `\/api\/workspace-attachments\/\$\{row\.id\}`/);
  assert.match(workspace, /if \(result\.url\) \{ window\.open\(result\.url, "_blank", "noopener,noreferrer"\); return; \}/);
  assert.match(searchDialog, /name=\{result\.url \? "download" : "next"\}/);
});

test("uses a single-screen article editor with in-place attachment operations", async () => {
  const [workspace, editor, cherry, library, styles] = await Promise.all([
    source("app/components/WorkspaceApp.tsx"),
    source("app/components/KnowledgeDocumentEditorDialog.tsx"),
    source("app/components/CherrySopEditor.tsx"),
    source("app/components/KnowledgeAttachmentLibrary.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(library, /附件和模板库/);
  assert.doesNotMatch(library, /管理附件|managerOpen|resource-template-modal|attachment-reference-modal|attachment-version-modal/);
  assert.doesNotMatch(library, /method:\s*"(?:POST|PUT|DELETE)"/);
  assert.match(library, /id={`knowledge-asset-\${attachment\.id}`}/);
  assert.match(editor, /#knowledge-asset-\${attachment\.id}/);
  assert.match(editor, /async function uploadAndInsert/);
  assert.match(editor, /onEnsureDocument/);
  assert.match(editor, /上传并插入/);
  assert.match(editor, /editorRef\.current\.insertAtCursor\(markdown\)/);
  assert.match(editor, /withoutAttachmentReferences/);
  assert.match(editor, /pendingDeleteIds/);
  assert.match(editor, /libraryPageSize = 4/);
  assert.match(editor, /const \[attachmentsOpen, setAttachmentsOpen\] = useState\(false\)/);
  assert.match(editor, /attachmentsOpen \? "attachments-open" : "attachments-collapsed"/);
  assert.match(editor, /className="doc-editor-side-toggle"/);
  assert.match(editor, /aria-expanded="false"/);
  assert.match(editor, /aria-expanded="true"/);
  assert.doesNotMatch(editor, /sideTab|editor-details-panel|editor-collaborator-panel|关键事项/);
  assert.match(editor, /items: \[\]/);
  assert.match(editor, /collaborators: preservedCollaborators/);
  assert.match(editor, /\/api\/inline-images/);
  assert.match(editor, /modal-backdrop document-editor-backdrop/);
  assert.match(editor, /文件树样式/);
  assert.match(editor, /documentTreeIconChoices\.map/);
  assert.match(editor, /type="color" value=\{treeIconColor\}/);
  assert.match(editor, /treeIcon, treeIconColor/);
  for (const label of ["新增附件或文本资料", "编辑附件或文本资料", "文本内容", "预览文本资料", "复制文本", "历史版本", "引用情况", "上传新版本", "解除正文引用", "保存后永久删除"]) assert.match(editor, new RegExp(label));
  assert.match(editor, /async function saveResource/);
  assert.match(editor, /\/api\/workspace-attachments\/\${attachment\.id}\/versions/);
  assert.match(editor, /\/api\/workspace-attachments\/\${attachment\.id}\/references\?/);
  assert.match(editor, /removeAttachment/);
  assert.match(editor, /setLibrary\(body\.attachments \|\| \[\]\)/);
  assert.match(workspace, /className="document-tree-icon" style=\{\{ color: item\.treeIconColor/);
  assert.match(workspace, /WorkspaceIcon name=\{item\.treeIcon \|\| "docs"\}/);
  assert.match(styles, /document-tree-style-popover/);
  assert.match(styles, /structure-manager-backdrop\{z-index:220\}/);
  assert.match(styles, /document-editor-backdrop,.version-history-backdrop\{z-index:240\}/);
  const saveGuardRelease = editor.indexOf('CustomEvent("workspace-dirty", { detail: false })', editor.indexOf("async function submit"));
  assert.ok(saveGuardRelease > -1 && saveGuardRelease < editor.indexOf("await onSave", saveGuardRelease), "保存前应先解除未保存导航拦截");
  assert.match(editor.slice(saveGuardRelease), /else window\.dispatchEvent\(new CustomEvent\("workspace-dirty", \{ detail: dirty \}\)\)/);
  assert.match(cherry, /fileUpload/);
  assert.match(cherry, /"image", "link"/);
  assert.doesNotMatch(cherry, /"file"/);
  assert.match(cherry, /engine: \{ syntax: \{ table: \{ enableChart: false \} \} \}/);
  assert.match(cherry, /getCodeMirror\(\)\.scrollDOM/);
  assert.match(cherry, /querySelector<HTMLElement>\("\.knowledge-editor-preview"\)/);
  assert.match(cherry, /editorScroll\.addEventListener\("scroll", syncPreviewScroll/);
  assert.match(cherry, /previewScroll\.addEventListener\("scroll", syncEditorScroll/);
  assert.match(cherry, /target\.scrollTop = progress \* Math\.max\(targetRange, 0\)/);
  assert.match(cherry, /removeEventListener\("scroll", syncPreviewScroll\)/);
  assert.match(cherry, /useImperativeHandle/);
  assert.match(cherry, /state\.selection\.main/);
  assert.match(cherry, /editor\.dispatch\(\{ changes:/);
  assert.match(styles, /cherry-sop-editor \.cherry\{[^}]*flex-flow:column nowrap/);
  assert.match(styles, /cherry-sop-editor \.cherry \.cherry-editor\{[^}]*min-height:0;max-height:none/);
  assert.match(styles, /cherry-doc-modal\{[^}]*height:calc\(100dvh - 24px\)[^}]*overflow:hidden/);
  assert.match(styles, /doc-editor-workspace\{[^}]*min-height:0[^}]*overflow:hidden/);
  assert.match(styles, /doc-editor-workspace\{[^}]*grid-template-columns:minmax\(0,1fr\) 44px/);
  assert.match(styles, /doc-editor-workspace\.attachments-open\{[^}]*grid-template-columns:minmax\(0,1fr\) 320px/);
  assert.match(styles, /doc-editor-side\.collapsed\{[^}]*overflow:hidden/);
  assert.match(styles, /cherry-doc-modal \.knowledge-editor-preview\{[^}]*overflow:auto/);
  assert.doesNotMatch(styles, /doc-editor-side\{[^}]*overflow:auto/);
  assert.match(editor, /attachment-reference-modal/); assert.match(editor, /attachment-version-modal/);
  assert.match(workspace, /focusReferencedAsset/);
  assert.match(styles, /asset-reference-highlight/);
  const sopPage = workspace.slice(workspace.indexOf("function SopPage"), workspace.indexOf("function ProductTemplates"));
  assert.doesNotMatch(sopPage, /<ProductTemplates/);
  assert.doesNotMatch(workspace, /<section className="doc-key-points"/);
  assert.match(sopPage, /documentId={record\.id}/);
});

test("preserves Obsidian Markdown and uses one preview pipeline before and after save", async () => {
  const [workspace, editor, cherry, markdown, templates, theme, styles, packageJson] = await Promise.all([
    source("app/components/WorkspaceApp.tsx"),
    source("app/components/KnowledgeDocumentEditorDialog.tsx"),
    source("app/components/CherrySopEditor.tsx"),
    source("app/components/KnowledgeMarkdown.tsx"),
    source("app/sections/templates/TemplateLibrary.tsx"),
    source("app/ionic-doc-theme.css"),
    source("app/globals.css"),
    source("package.json"),
  ]);
  assert.match(packageJson, /"mermaid": "11\.17\.0"/);
  assert.match(cherry, /convertWhenPaste: false/);
  assert.match(cherry, /defaultModel: "editOnly"/);
  assert.match(cherry, /toolbars: \{ toc: false,/);
  assert.match(cherry, /<KnowledgeMarkdown markdown={value}/);
  assert.match(editor, /accept="\.md,text\/markdown,text\/plain"/);
  assert.match(editor, /extractObsidianEmbedNames\(draft\)/);
  assert.match(editor, /linkedAttachments/);
  assert.match(markdown, /import\("mermaid"\)/);
  assert.match(markdown, /language-mermaid/);
  assert.match(markdown, /mermaidStart\.test\(source\.trimStart\(\)\)/);
  assert.match(markdown, /obsidian-callout/);
  assert.match(markdown, /#obsidian-wiki=/);
  assert.match(markdown, /#obsidian-embed=/);
  assert.match(workspace, /workspace-wiki-link/);
  assert.match(templates, /filter-row term-categories/);
  assert.match(templates, /#124f9f[^\n]+全部分类/);
  assert.match(templates, /template-preview-content ionic-doc-theme/);
  assert.doesNotMatch(templates, /ReactMarkdown|remarkGfm/);
  assert.match(styles, /\.template-toolbar \.term-categories button\.active/);
  assert.match(styles, /\.template-toolbar \{[\s\S]*?background: #fff;/);
  assert.match(theme, /\.template-preview-content\.ionic-doc-theme p \{ white-space: pre-wrap; \}/);
  assert.match(theme, /list-style: disc/);
  assert.match(theme, /list-style: decimal/);
  assert.match(theme, /li > p \{ margin: 0; \}/);
  assert.match(theme, /mermaid-diagram/);
  assert.match(markdown, /mermaidRenderQueue/);
  assert.match(markdown, /createPortal\(<MediaLightbox/);
  assert.match(markdown, /aria-modal="true"/);
  assert.match(markdown, /关闭放大预览/);
  assert.match(markdown, /mermaid-diagram mermaid-zoom-trigger/);
  assert.match(theme, /markdown-image-zoom-trigger/);
  assert.match(styles, /\.markdown-media-lightbox\{/);
  assert.match(styles, /\.markdown-media-lightbox-mermaid svg\{/);
  assert.match(markdown, /memo\(function KnowledgeMarkdown/);
  assert.match(markdown, /IntersectionObserver/);
  assert.match(markdown, /requestIdleCallback/);
  assert.match(markdown, /rootMargin: "80px 0px"/);
  assert.match(workspace, /requestAnimationFrame\(update\)/);
  assert.match(workspace, /new ResizeObserver\(onResize\)/);
  assert.match(workspace, /while \(low < high\)/);
  assert.match(workspace, /current === low \? current : low/);
  assert.match(workspace, /type DocumentHeading = \{ text: string; level: number \}/);
  assert.ok(workspace.includes('const match = line.match(/^(#{1,6})\\s+(.+?)\\s*$/);'));
  assert.match(workspace, /toc-level-\$\{heading\.level\}/);
  assert.match(workspace, /documentHeadingSelector\("sop-reader"\)/);
  assert.match(theme, /button\.toc-level-2 \{ padding-left: 12px; \}/);
  assert.match(theme, /button\.toc-level-6 \{ padding-left: 60px; \}/);
  assert.match(theme, /font-size: 16px;\s*line-height: 1\.72;/);
  assert.match(theme, /h2 \{ margin: 3rem 0 \.9rem;/);
  assert.match(theme, /h3 \{ margin: 2\.25rem 0 \.75rem;/);
  assert.match(theme, /h5 \+ h6\) \{ margin-top: \.75rem; \}/);
  assert.match(theme, /details\) \{ margin-top: 0; margin-bottom: 1rem; \}/);
  assert.match(theme, /line-height: 1\.55/);
  assert.match(theme, /li \{ margin: \.06rem 0/);
  assert.match(theme, /li > :where\(ul, ol\) \{ margin: \.08rem 0 \.14rem/);
});

test("allows either text content or an attachment in the general template library", async () => {
  const [library, collectionRoute, itemRoute] = await Promise.all([
    source("app/sections/templates/TemplateLibrary.tsx"),
    source("app/api/templates/route.ts"),
    source("app/api/templates/[id]/route.ts"),
  ]);
  assert.doesNotMatch(library, /textarea name="content" required/);
  assert.match(library, /文本内容和附件至少需要填写一项/);
  assert.match(library, /keepsCurrentAttachment/);
  assert.match(collectionRoute, /if \(!content && !file\)/);
  assert.match(collectionRoute, /文本内容和附件至少需要填写一项/);
  assert.match(itemRoute, /keepsCurrentAttachment = Boolean\(current\.attachment_key\) && !removeAttachment/);
  assert.match(itemRoute, /if \(!content && !file && !keepsCurrentAttachment\)/);
  assert.match(itemRoute, /文本内容和附件至少需要保留一项/);
});
test("keeps metadata-rich resources isolated to their owning knowledge article", async () => {
  const [workspace, library, editor, collectionRoute, itemRoute, assets, styles] = await Promise.all([
    source("app/components/WorkspaceApp.tsx"),
    source("app/components/KnowledgeAttachmentLibrary.tsx"),
    source("app/components/KnowledgeDocumentEditorDialog.tsx"),
    source("app/api/workspace-attachments/route.ts"),
    source("app/api/workspace-attachments/[id]/route.ts"),
    source("db/workspace-assets.ts"),
    source("app/globals.css"),
  ]);
  assert.match(workspace, /scope=\{other \? "other-doc" : "doc"\}/);
  assert.match(workspace, /<KnowledgeAttachmentLibrary scope="sop"/);
  assert.match(editor, /显示名称<input name="title"/);
  assert.match(editor, /一句话说明<input name="summary"/);
  assert.match(editor, /文本内容[\s\S]*<textarea name="content"/);
  assert.match(editor, /name="file" type="file"/);
  assert.match(library, /hasContent && <button[\s\S]*复制文本/);
  assert.match(library, /hasAttachment && <a href=\{attachment\.url\} download/);
  assert.match(library, /resource-template-preview/);
  assert.match(collectionRoute, /文本内容和上传附件至少需要填写一项/);
  assert.match(collectionRoute, /a\.document_id = \?/);
  assert.match(collectionRoute, /document_id, title, summary, content/);
  assert.match(library, /new URLSearchParams\(\{ scope, documentId \}\)/);
  assert.match(editor, /form\.set\("documentId", target\.id\)/);
  assert.match(itemRoute, /export async function PUT/);
  assert.match(itemRoute, /removeAttachment/);
  assert.match(assets, /ALTER TABLE workspace_attachments ADD COLUMN title/);
  assert.match(assets, /ALTER TABLE workspace_attachments ADD COLUMN document_id/);
  assert.match(assets, /title: row\.title\?\.trim\(\)/);
  assert.match(editor, /setLibrary\(body\.attachments \|\| \[\]\)/);
  assert.doesNotMatch(editor, /filter\(\(item: KnowledgeAttachment\) => item\.hasAttachment !== false/);
  assert.match(styles, /Shared resource records for general knowledge, SOP and other materials/);
});
test("uses stable drag handles, rollback-safe sorting, and consistent orphan attachment rules", async () => {
  const [workspace, styles, orderRoute, catalogOrderRoute, orphanScanner, cleanupRoute] = await Promise.all([
    source("app/components/WorkspaceApp.tsx"),
    source("app/globals.css"),
    source("app/api/knowledge-documents/order/route.ts"),
    source("app/api/catalog/order/route.ts"),
    source("app/lib/orphan-attachments.ts"),
    source("app/api/admin/attachments/cleanup/route.ts"),
  ]);
  assert.match(workspace, /structure-sort-handle/);
  assert.match(workspace, /catalog-sort-handle/);
  assert.match(workspace, /template-sort-handle/);
  assert.match(workspace, /setData\(previous\)/);
  assert.match(workspace, /structurePreviewRef/);
  assert.match(workspace, /trackerDropCommitted/);
  assert.match(workspace, /pointerIsAfter/);
  assert.match(workspace, /function applyIdOrder/);
  assert.match(workspace, /selected\.has\(item\.id\) \? \{ \.\.\.byId\.get\(ids\[pointer\]\)!, sortOrder: pointer\+\+ \} : item/);
  assert.doesNotMatch(workspace, /const assignOrder/);
  assert.match(workspace, /canSort=\{profile\.role !== "viewer"\}/);
  assert.doesNotMatch(workspace, /startViewTransition/);
  assert.doesNotMatch(workspace, /<article draggable className=\{`\$\{productDrag/);
  assert.match(styles, /\.sorting-over\{[^}]*outline:/);
  assert.doesNotMatch(styles, /\.sorting-over\{[^}]*translateY/);
  assert.match(orderRoute, /"general", "other", "sop"/);
  assert.match(orderRoute, /"documents", "categories"/);
  assert.match(orderRoute, /access\.profile\.role !== "admin" && access\.profile\.role !== "editor"/);
  assert.match(orderRoute, /new Set\(requested\)\.size === requested\.length/);
  assert.match(catalogOrderRoute, /access\.profile\.role !== "admin" && access\.profile\.role !== "editor"/);
  assert.match(catalogOrderRoute, /mergeSubset/);
  assert.match(catalogOrderRoute, /isWorkspaceScopeAllowed/);
  assert.match(styles, /\.picker-sort-handle/);
  assert.match(styles, /--brand-card-uploaded-logo-opacity:\.50/);
  assert.match(styles, /--product-card-uploaded-logo-opacity:\.50/);
  assert.match(styles, /\.brand-grid button>span svg\{opacity:\.24\}/);
  assert.match(styles, /\.brand-grid button>span img\.custom-workspace-icon\{opacity:var\(--brand-card-uploaded-logo-opacity\)!important\}/);
  assert.match(styles, /\.product-grid button>span svg\{opacity:\.22\}/);
  assert.match(styles, /\.product-grid button>span img\.custom-workspace-icon\{opacity:var\(--product-card-uploaded-logo-opacity\)!important\}/);
  assert.match(styles, /\.catalog-list\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(styles, /\.catalog-list>button\{[^}]*width:100%;[^}]*max-width:100%;[^}]*grid-template-columns:38px minmax\(0,1fr\) auto/);
  assert.match(styles, /\.catalog-list>button>b\{[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap/);
  assert.match(styles, /\.catalog-row-actions\{[^}]*min-width:max-content;[^}]*flex:none/);
  assert.match(styles, /\.modal-backdrop\{[^}]*anchor-scope:--floating-window/);
  assert.match(styles, /\.modal\{[^}]*anchor-name:--floating-window/);
  assert.match(styles, /\.modal>header>button\{[^}]*position:fixed;[^}]*position-anchor:--floating-window;[^}]*top:anchor\(top\);[^}]*left:anchor\(right\)/);
  assert.match(styles, /\.template-dialog\{[^}]*anchor-name:--floating-window/);
  assert.match(styles, /\.dialog-head>button\{[^}]*position:fixed;[^}]*position-anchor:--floating-window/);
  assert.match(styles, /\.search-dialog>footer button\{[^}]*position:fixed;[^}]*position-anchor:--floating-window/);
  assert.match(orphanScanner, /d\.deleted_at IS NOT NULL/);
  assert.match(orphanScanner, /deletedDocumentIds\.has\(row\.id\)/);
  assert.match(cleanupRoute, /workspace_attachment_versions/);
  assert.match(cleanupRoute, /仅被已删除文章引用/);
});
