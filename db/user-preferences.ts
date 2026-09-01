import { sqlite } from "./local";

export function ensureUserPreferenceSchema() {
  const database = sqlite as unknown as { exec: (sql: string) => void };
  database.exec(`CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT NOT NULL,
    preference_key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, preference_key)
  )`);
  database.exec("CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences (user_id, updated_at DESC)");
}

export function readUserPreference<T>(userId: string, key: string, fallback: T): T {
  ensureUserPreferenceSchema();
  const row = sqlite.prepare("SELECT value_json FROM user_preferences WHERE user_id = ? AND preference_key = ?").get(userId, key) as { value_json: string } | undefined;
  if (!row) return fallback;
  try { return JSON.parse(row.value_json) as T; } catch { return fallback; }
}

export function writeUserPreference(userId: string, key: string, value: unknown) {
  ensureUserPreferenceSchema();
  sqlite.prepare(`INSERT INTO user_preferences (user_id, preference_key, value_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, preference_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
    .run(userId, key, JSON.stringify(value), new Date().toISOString());
}

export function orderByPreference<T>(items: T[], ids: string[], idOf: (item: T) => string) {
  if (!Array.isArray(ids) || ids.length === 0) return items;
  const position = new Map(ids.map((id, index) => [id, index]));
  return [...items].sort((left, right) => (position.get(idOf(left)) ?? Number.MAX_SAFE_INTEGER) - (position.get(idOf(right)) ?? Number.MAX_SAFE_INTEGER));
}
