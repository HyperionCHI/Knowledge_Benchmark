import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqlite } from "../../../db/local";
import { user } from "../../../db/schema";
import { readWorkspaceState, writeWorkspaceState } from "../../../db/workspace";
import { currentSession } from "../../lib/auth";

export async function GET(request: Request) {
  const session = await currentSession(request);
  if (!session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
  const row = await drizzle(sqlite).select({ name: user.name, username: user.username, role: user.role }).from(user).where(eq(user.id, session.user.id)).get();
  return Response.json({ profile: { ...row, email: session.user.email } });
}

export async function PUT(request: Request) {
  const session = await currentSession(request);
  if (!session?.user) return Response.json({ error: "请先登录。" }, { status: 401 });
  const body = await request.json() as { name?: string };
  const name = String(body.name || "").trim();
  if (name.length < 2 || name.length > 40) return Response.json({ error: "显示名称需要为 2–40 个字符。" }, { status: 400 });
  await drizzle(sqlite).update(user).set({ name, updatedAt: new Date() }).where(eq(user.id, session.user.id)).run();
  const state = await readWorkspaceState();
  state.users = state.users.map((item) => item.id === session.user.id ? { ...item, name } : item);
  await writeWorkspaceState(state);
  return Response.json({ saved: true, name });
}
