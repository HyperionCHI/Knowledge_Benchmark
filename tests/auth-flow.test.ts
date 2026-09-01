import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const databasePath = resolve("data/qa-auth.sqlite");
const attachmentPath = resolve("data/qa-auth-attachments");
process.env.WORKBENCH_DB_PATH = databasePath;
process.env.WORKBENCH_ATTACHMENT_DIR = attachmentPath;
process.env.BETTER_AUTH_URL = "http://localhost:3999";
process.env.BETTER_AUTH_SECRET = "qa-only-secret-for-workbench-auth-chain-2026";

await Promise.all([databasePath, `${databasePath}-wal`, `${databasePath}-shm`].map((path) => rm(path, { force: true })));
await rm(attachmentPath, { recursive: true, force: true });

const bootstrap = await import("../app/api/auth-bootstrap/route");
const { auth } = await import("../app/lib/auth");
const termsRoute = await import("../app/api/terms/route");
const usersRoute = await import("../app/api/users/route");
const knowledgeExportRoute = await import("../app/api/knowledge-export/route");
const inlineImagesRoute = await import("../app/api/inline-images/route");
const inlineImageRoute = await import("../app/api/inline-images/[id]/route");
const { sqlite } = await import("../db/local");
const { ensureWorkspaceAssetSchema } = await import("../db/workspace-assets");

try {
  const initial = await bootstrap.GET();
  assert.deepEqual(await initial.json(), { needsSetup: true });

  const created = await bootstrap.POST(new Request("http://localhost:3999/api/auth-bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "qa_admin", password: "Qa-password-2026", name: "QA 管理员" }),
  }));
  assert.equal(created.status, 200);

  const secondSetup = await bootstrap.GET();
  assert.deepEqual(await secondSetup.json(), { needsSetup: false });

  const unauthorized = await termsRoute.GET(new Request("http://localhost:3999/api/terms"));
  assert.equal(unauthorized.status, 401);

  const signedIn = await auth.handler(new Request("http://localhost:3999/api/auth/sign-in/username", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3999" },
    body: JSON.stringify({ username: "qa_admin", password: "Qa-password-2026" }),
  }));
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie, "登录响应应写入会话 Cookie");

  const authorized = await termsRoute.GET(new Request("http://localhost:3999/api/terms", { headers: { cookie } }));
  assert.equal(authorized.status, 200);
  const payload = await authorized.json() as { terms?: unknown[] };
  assert.equal(payload.terms?.length || 0, 0, "干净副本首次登录时不应写入术语数据");
  await ensureWorkspaceAssetSchema();
  const attachmentBefore = (sqlite.prepare("SELECT COUNT(*) AS total FROM workspace_attachments").get() as { total: number }).total;
  const imageForm = new FormData();
  imageForm.set("scope", "doc");
  imageForm.set("documentId", "");
  imageForm.set("file", new File([new Uint8Array([137, 80, 78, 71])], "inline.png", { type: "image/png" }));
  const imageUploaded = await inlineImagesRoute.POST(new Request("http://localhost:3999/api/inline-images", { method: "POST", headers: { cookie }, body: imageForm }));
  assert.ok(imageUploaded);
  assert.equal(imageUploaded.status, 201);
  const imagePayload = await imageUploaded.json() as { image?: { id?: string; url?: string } };
  assert.match(imagePayload.image?.url || "", /^\/api\/inline-images\//);
  const inlineImageTotal = (sqlite.prepare("SELECT COUNT(*) AS total FROM workspace_inline_images").get() as { total: number }).total;
  const attachmentAfter = (sqlite.prepare("SELECT COUNT(*) AS total FROM workspace_attachments").get() as { total: number }).total;
  assert.equal(inlineImageTotal, 1, "正文图片应写入独立图片表");
  assert.equal(attachmentAfter, attachmentBefore, "正文图片不应写入附件表");
  const inlineImageId = imagePayload.image?.id || "";
  const inlineImageFetched = await inlineImageRoute.GET(new Request(`http://localhost:3999/api/inline-images/${inlineImageId}`, { headers: { cookie } }), { params: Promise.resolve({ id: inlineImageId }) });
  assert.equal(inlineImageFetched.status, 200);
  assert.equal(inlineImageFetched.headers.get("content-type"), "image/png");

  const anonymousExport = await knowledgeExportRoute.GET(new Request("http://localhost:3999/api/knowledge-export?kind=general"));
  assert.equal(anonymousExport.status, 401);

  const viewerCreated = await usersRoute.POST(new Request("http://localhost:3999/api/users", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ username: "qa_viewer", password: "Qa-viewer-password-2026", name: "QA 普通用户", role: "viewer", scopes: ["*"] }),
  }));
  assert.equal(viewerCreated.status, 201);
  const viewerSignedIn = await auth.handler(new Request("http://localhost:3999/api/auth/sign-in/username", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3999" },
    body: JSON.stringify({ username: "qa_viewer", password: "Qa-viewer-password-2026" }),
  }));
  assert.equal(viewerSignedIn.status, 200);
  const viewerCookie = viewerSignedIn.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(viewerCookie, "普通用户登录响应应写入会话 Cookie");
  const forbiddenExport = await knowledgeExportRoute.GET(new Request("http://localhost:3999/api/knowledge-export?kind=general", { headers: { cookie: viewerCookie } }));
  assert.equal(forbiddenExport.status, 403);
  assert.deepEqual(await forbiddenExport.json(), { error: "仅管理员可批量导出知识库。" });
} finally {
  sqlite.close();
  await Promise.all([databasePath, `${databasePath}-wal`, `${databasePath}-shm`].map((path) => rm(path, { force: true })));
  await rm(attachmentPath, { recursive: true, force: true });
}

console.log("auth-flow: ok");
