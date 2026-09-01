import { auth } from "../../lib/auth";
import { getLocalDatabase } from "../../../db/local";

function db() { return getLocalDatabase(); }

async function ensureTables() {
  const DB = db();
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, username TEXT UNIQUE, display_username TEXT, role TEXT NOT NULL DEFAULT 'viewer', banned INTEGER NOT NULL DEFAULT 0, ban_reason TEXT, ban_expires INTEGER)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY NOT NULL, expires_at INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ip_address TEXT, user_agent TEXT, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, impersonated_by TEXT)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS account (id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, provider_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, access_token TEXT, refresh_token TEXT, id_token TEXT, access_token_expires_at INTEGER, refresh_token_expires_at INTEGER, scope TEXT, password TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS verification (id TEXT PRIMARY KEY NOT NULL, identifier TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER, updated_at INTEGER)`),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_session_user_id ON session(user_id)"),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_account_user_id ON account(user_id)"),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification(identifier)"),
  ]);
}

export async function GET() {
  try { await ensureTables(); const count = await db().prepare("SELECT COUNT(*) AS total FROM user").first<{ total: number }>(); return Response.json({ needsSetup: Number(count?.total || 0) === 0 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "初始化检查失败" }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    await ensureTables();
    const count = await db().prepare("SELECT COUNT(*) AS total FROM user").first<{ total: number }>();
    if (Number(count?.total || 0) > 0) return Response.json({ error: "系统已完成初始化。" }, { status: 409 });
    const body = await request.json() as { username?: string; password?: string; name?: string };
    const usernameValue = body.username?.trim().toLowerCase() || "";
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(usernameValue)) return Response.json({ error: "账号需为 3–30 位字母、数字、点、下划线或短横线。" }, { status: 400 });
    if (!body.password || body.password.length < 8) return Response.json({ error: "密码至少 8 位。" }, { status: 400 });
    const result = await auth.api.signUpEmail({ body: { email: `${usernameValue}@knowledge-workbench.local`, name: body.name?.trim() || usernameValue, password: body.password, username: usernameValue, displayUsername: usernameValue } });
    await db().prepare("UPDATE user SET role = 'admin' WHERE id = ?").bind(result.user.id).run();
    return Response.json({ created: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "管理员创建失败" }, { status: 500 }); }
}
