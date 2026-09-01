import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "../../../lib/auth";
import { audit, ensureWorkspaceRecordSchema } from "../../../../db/workspace-records";
import { readWorkspaceState } from "../../../../db/workspace";
import { sqlite } from "../../../../db/local";

const handlers = toNextJsHandler(auth);
export const GET = handlers.GET;
export async function POST(request: Request) {
  if (new URL(request.url).pathname.endsWith("/sign-up/email")) return Response.json({ error: "账号仅可由管理员创建。" }, { status: 403 });
  const isLogin = new URL(request.url).pathname.endsWith("/sign-in/username"); const copy = isLogin ? request.clone() : null; const response = await handlers.POST(request);
  if (isLogin && copy) { try { const body = await copy.json() as { username?: string }; const user = sqlite.prepare("SELECT id, name FROM user WHERE username = ?").get(body.username?.trim().toLowerCase() || "") as { id: string; name: string } | undefined; ensureWorkspaceRecordSchema(await readWorkspaceState()); audit({ id: user?.id || "unknown", name: user?.name || body.username || "未知账号" }, response.ok ? "login" : "login-failed", "user", user?.id || "unknown", `${request.headers.get("x-forwarded-for") || "local"} · ${request.headers.get("user-agent")?.slice(0, 120) || "unknown"}`); } catch { /* 登录审计失败不能阻断登录 */ } }
  return response;
}
