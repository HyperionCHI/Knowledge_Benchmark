import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, username } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema";
import { sqlite } from "../../db/local";

const trustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const userColumns = sqlite.prepare("PRAGMA table_info(user)").all() as Array<{ name: string }>;
if (userColumns.length) {
  if (!userColumns.some((column) => column.name === "banned")) sqlite.prepare("ALTER TABLE user ADD COLUMN banned INTEGER NOT NULL DEFAULT 0").run();
  if (!userColumns.some((column) => column.name === "ban_reason")) sqlite.prepare("ALTER TABLE user ADD COLUMN ban_reason TEXT").run();
  if (!userColumns.some((column) => column.name === "ban_expires")) sqlite.prepare("ALTER TABLE user ADD COLUMN ban_expires INTEGER").run();
  const sessionColumns = sqlite.prepare("PRAGMA table_info(session)").all() as Array<{ name: string }>;
  if (sessionColumns.length && !sessionColumns.some((column) => column.name === "impersonated_by")) sqlite.prepare("ALTER TABLE session ADD COLUMN impersonated_by TEXT").run();
}

export const auth = betterAuth({
  appName: "内部知识工作台",
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins,
  secret: process.env.BETTER_AUTH_SECRET || "knowledge-workbench-local-development-secret-change-before-production-2026",
  database: drizzleAdapter(drizzle(sqlite, { schema }), {
    provider: "sqlite",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  user: {
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "viewer", input: false },
    },
  },
  disabledPaths: ["/is-username-available"],
  plugins: [username({ minUsernameLength: 3, maxUsernameLength: 30 }), admin({ defaultRole: "viewer", adminRoles: ["admin"], bannedUserMessage: "该账号已停用，请联系管理员。" })],
  session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60 },
  rateLimit: { enabled: true, window: 60, max: 30 },
});

export async function currentSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}
