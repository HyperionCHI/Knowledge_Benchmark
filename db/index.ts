import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { sqlite } from "./local";

export function getDb() {
  return drizzle(sqlite, { schema });
}
