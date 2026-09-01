import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const databasePath = resolve(process.env.WORKBENCH_DB_PATH || "data/workbench.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });

const globalDatabase = globalThis as typeof globalThis & { __knowledgeWorkbenchSqlite?: Database };

export const sqlite = globalDatabase.__knowledgeWorkbenchSqlite ?? new Database(databasePath);
globalDatabase.__knowledgeWorkbenchSqlite = sqlite;
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

class LocalPreparedStatement {
  constructor(private readonly sql: string, private readonly parameters: unknown[] = []) {}

  bind(...parameters: unknown[]) {
    return new LocalPreparedStatement(this.sql, parameters);
  }

  runSync() {
    const result = sqlite.prepare(this.sql).run(...this.parameters);
    return { success: true, meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
  }

  async run() {
    return this.runSync();
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = sqlite.prepare(this.sql).get(...this.parameters) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async all<T>() {
    return { success: true, results: sqlite.prepare(this.sql).all(...this.parameters) as T[] };
  }
}

export class LocalDatabase {
  prepare(sql: string) {
    return new LocalPreparedStatement(sql);
  }

  async batch(statements: LocalPreparedStatement[]) {
    return sqlite.transaction(() => statements.map((statement) => statement.runSync()))();
  }

  async exec(sql: string) {
    sqlite.prepare(sql).run();
    return { count: 1, duration: 0 };
  }
}

const localDatabase = new LocalDatabase();

export function getLocalDatabase() {
  return localDatabase;
}
