import { currentSession } from "../../lib/auth";
import { readUserPreference, writeUserPreference } from "../../../db/user-preferences";

const validKey = /^(brand-order|doc-order|template-order|product-order:[a-zA-Z0-9_-]{1,80}|product-template-order:[a-zA-Z0-9_-]{1,80})$/;

export async function GET(request: Request) {
  const session = await currentSession(request);
  if (!session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!validKey.test(key)) return Response.json({ error: "排序偏好类型无效。" }, { status: 400 });
  return Response.json({ ids: readUserPreference<string[]>(session.user.id, key, []) });
}

export async function PUT(request: Request) {
  const session = await currentSession(request);
  if (!session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
  const body = await request.json() as { key?: string; ids?: unknown[] };
  if (!body.key || !validKey.test(body.key) || !Array.isArray(body.ids) || body.ids.length > 1000 || body.ids.some((id) => typeof id !== "string" || id.length > 120)) return Response.json({ error: "排序数据无效。" }, { status: 400 });
  if (body.key === "doc-order" && (session.user as typeof session.user & { role?: string }).role !== "admin") return Response.json({ error: "只有管理员可以调整资料顺序。" }, { status: 403 });
  writeUserPreference(session.user.id, body.key, [...new Set(body.ids as string[])]);
  return Response.json({ saved: true });
}
