import seedData from "../app/sections/terminology/terminology-data.json";
import { getLocalDatabase, type LocalDatabase } from "./local";

export type CategoryRecord = {
  id: string;
  name: string;
  description: string;
  color: string;
  termCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TermRecord = {
  id: string;
  categoryId: string;
  chinese: string;
  abbreviation: string;
  english: string;
  definition: string;
  scenario: string;
  source: string;
  createdAt: string;
  updatedAt: string;
};

type CategoryRow = Omit<CategoryRecord, "termCount" | "createdAt" | "updatedAt"> & { term_count: number; created_at: string; updated_at: string };
type TermRow = Omit<TermRecord, "categoryId" | "createdAt" | "updatedAt"> & { category_id: string; sort_initial: string; created_at: string; updated_at: string };

const pinyinInitialAnchors = [
  ["A", "阿"], ["B", "八"], ["C", "擦"], ["D", "搭"], ["E", "蛾"], ["F", "发"], ["G", "噶"], ["H", "哈"],
  ["J", "击"], ["K", "咔"], ["L", "垃"], ["M", "妈"], ["N", "拿"], ["O", "哦"], ["P", "啪"], ["Q", "七"],
  ["R", "然"], ["S", "撒"], ["T", "他"], ["W", "挖"], ["X", "昔"], ["Y", "压"], ["Z", "匝"],
] as const;

const pinyinCollator = new Intl.Collator("zh-CN-u-co-pinyin", { sensitivity: "base" });

const seedMigrations = [
  {
    version: 5,
    termIds: [
      "seed-046", "seed-081", "seed-115",
      "seed-247", "seed-248", "seed-249", "seed-250", "seed-251",
      "seed-252", "seed-253", "seed-254", "seed-255", "seed-256",
    ],
  },
] as const;

export function getTermSortInitial(value: string) {
  const first = Array.from(value.trim()).find((character) => /[A-Za-z\u3400-\u9fff]/u.test(character));
  if (!first) return "#";
  if (/[A-Za-z]/.test(first)) return first.toUpperCase();
  for (let index = pinyinInitialAnchors.length - 1; index >= 0; index -= 1) {
    if (pinyinCollator.compare(first, pinyinInitialAnchors[index][1]) >= 0) return pinyinInitialAnchors[index][0];
  }
  return "#";
}

function getDb() {
  return getLocalDatabase();
}

export async function ensureTerminologySchema() {
  const DB = getDb();
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS term_categories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#124f9f',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_term_categories_name ON term_categories (name)"),
    DB.prepare(`CREATE TABLE IF NOT EXISTS terms (
      id TEXT PRIMARY KEY NOT NULL,
      category_id TEXT NOT NULL REFERENCES term_categories(id) ON DELETE RESTRICT ON UPDATE CASCADE,
      chinese TEXT NOT NULL,
      abbreviation TEXT NOT NULL DEFAULT '',
      english TEXT NOT NULL DEFAULT '',
      sort_initial TEXT NOT NULL DEFAULT '#',
      definition TEXT NOT NULL,
      scenario TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_terms_category_id ON terms (category_id)"),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_terms_chinese ON terms (chinese)"),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_terms_updated_at ON terms (updated_at)"),
    DB.prepare("CREATE TABLE IF NOT EXISTS terminology_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)"),
  ]);

  const termColumns = await DB.prepare("PRAGMA table_info(terms)").all<{ name: string }>();
  if (!termColumns.results.some((column) => column.name === "sort_initial")) {
    await DB.prepare("ALTER TABLE terms ADD COLUMN sort_initial TEXT NOT NULL DEFAULT '#'").run();
  }
  await DB.prepare("CREATE INDEX IF NOT EXISTS idx_terms_sort_initial ON terms (sort_initial)").run();

  const seeded = await DB.prepare("SELECT value FROM terminology_meta WHERE key = ?").bind("seed_version").first<{ value: string }>();
  if (!seeded) {
    const now = new Date().toISOString();
    const categoryStatements = seedData.categories.map((category) => DB.prepare(
      "INSERT OR IGNORE INTO term_categories (id, name, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(category.id, category.name, category.description, category.color, now, now));
    await runBatches(DB, categoryStatements);

    const termStatements = seedData.terms.map((term) => DB.prepare(
      `INSERT OR IGNORE INTO terms (
        id, category_id, chinese, abbreviation, english, sort_initial, definition, scenario, source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(term.id, term.categoryId, term.chinese, term.abbreviation, term.english, getTermSortInitial(term.chinese), term.definition, term.scenario, term.source, now, now));
    await runBatches(DB, termStatements);
    await DB.prepare("INSERT OR REPLACE INTO terminology_meta (key, value) VALUES (?, ?)").bind("seed_version", String(seedData.version)).run();
  } else {
    const currentSeedVersion = Number(seeded.value) || 0;
    const pendingIds = new Set<string>(seedMigrations
      .filter((migration) => migration.version > currentSeedVersion && migration.version <= seedData.version)
      .flatMap((migration) => [...migration.termIds]));
    const pendingTerms = seedData.terms.filter((term) => pendingIds.has(term.id));

    if (pendingTerms.length > 0) {
      const now = new Date().toISOString();
      const migrationStatements = pendingTerms.map((term) => DB.prepare(
        `INSERT INTO terms (
          id, category_id, chinese, abbreviation, english, sort_initial, definition, scenario, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          category_id = excluded.category_id,
          chinese = excluded.chinese,
          abbreviation = excluded.abbreviation,
          english = excluded.english,
          sort_initial = excluded.sort_initial,
          definition = excluded.definition,
          scenario = excluded.scenario,
          source = excluded.source
        WHERE terms.created_at = terms.updated_at`,
      ).bind(term.id, term.categoryId, term.chinese, term.abbreviation, term.english, getTermSortInitial(term.chinese), term.definition, term.scenario, term.source, now, now));
      await runBatches(DB, migrationStatements);
    }

    if (currentSeedVersion < seedData.version) {
      await DB.prepare("INSERT OR REPLACE INTO terminology_meta (key, value) VALUES (?, ?)").bind("seed_version", String(seedData.version)).run();
    }
  }

  const initialVersion = await DB.prepare("SELECT value FROM terminology_meta WHERE key = ?").bind("sort_initial_version").first<{ value: string }>();
  if (!initialVersion) {
    const existingTerms = await DB.prepare("SELECT id, chinese FROM terms").all<{ id: string; chinese: string }>();
    await runBatches(DB, existingTerms.results.map((term) => DB.prepare("UPDATE terms SET sort_initial = ? WHERE id = ?").bind(getTermSortInitial(term.chinese), term.id)));
    await DB.prepare("INSERT OR REPLACE INTO terminology_meta (key, value) VALUES (?, ?)").bind("sort_initial_version", "1").run();
  }
}

async function runBatches(DB: LocalDatabase, statements: ReturnType<LocalDatabase["prepare"]>[]) {
  for (let index = 0; index < statements.length; index += 75) await DB.batch(statements.slice(index, index + 75));
}

export function mapTerm(row: TermRow): TermRecord {
  const { category_id, sort_initial: _sortInitial, created_at, updated_at, ...term } = row;
  void _sortInitial;
  return { ...term, categoryId: category_id, createdAt: created_at, updatedAt: updated_at };
}

export function mapCategory(row: CategoryRow): CategoryRecord {
  return { id: row.id, name: row.name, description: row.description, color: row.color, termCount: Number(row.term_count), createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function listCategories() {
  await ensureTerminologySchema();
  const result = await getDb().prepare(`SELECT c.*, COUNT(t.id) AS term_count
    FROM term_categories c LEFT JOIN terms t ON t.category_id = c.id
    GROUP BY c.id ORDER BY c.name COLLATE NOCASE`).all<CategoryRow>();
  return result.results.map(mapCategory);
}

export async function listTerms(query: string, categoryId: string, limit: number, offset: number) {
  await ensureTerminologySchema();
  const DB = getDb();
  const filters: string[] = [];
  const filterBindings: unknown[] = [];
  let relevanceOrder = "sort_initial COLLATE NOCASE, chinese COLLATE NOCASE, abbreviation COLLATE NOCASE, english COLLATE NOCASE, updated_at DESC";
  const relevanceBindings: unknown[] = [];
  if (categoryId) { filters.push("category_id = ?"); filterBindings.push(categoryId); }
  if (query) {
    filters.push("(chinese LIKE ? OR abbreviation LIKE ? OR english LIKE ? OR definition LIKE ? OR scenario LIKE ?)");
    const pattern = `%${query}%`;
    const prefixPattern = `${query}%`;
    filterBindings.push(pattern, pattern, pattern, pattern, pattern);
    relevanceOrder = `CASE
      WHEN chinese = ? COLLATE NOCASE THEN 0
      WHEN abbreviation = ? COLLATE NOCASE THEN 1
      WHEN english = ? COLLATE NOCASE THEN 2
      WHEN chinese LIKE ? COLLATE NOCASE THEN 3
      WHEN abbreviation LIKE ? COLLATE NOCASE THEN 4
      WHEN english LIKE ? COLLATE NOCASE THEN 5
      WHEN chinese LIKE ? COLLATE NOCASE THEN 6
      WHEN abbreviation LIKE ? COLLATE NOCASE THEN 7
      WHEN english LIKE ? COLLATE NOCASE THEN 8
      WHEN definition LIKE ? COLLATE NOCASE THEN 9
      WHEN scenario LIKE ? COLLATE NOCASE THEN 10
      ELSE 11
    END, sort_initial COLLATE NOCASE, chinese COLLATE NOCASE, abbreviation COLLATE NOCASE, english COLLATE NOCASE, updated_at DESC`;
    relevanceBindings.push(
      query, query, query,
      prefixPattern, prefixPattern, prefixPattern,
      pattern, pattern, pattern,
      pattern, pattern,
    );
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const rows = await DB.prepare(`SELECT * FROM terms ${where} ORDER BY ${relevanceOrder} LIMIT ? OFFSET ?`).bind(...filterBindings, ...relevanceBindings, limit, offset).all<TermRow>();
  const count = await DB.prepare(`SELECT COUNT(*) AS total FROM terms ${where}`).bind(...filterBindings).first<{ total: number }>();
  return { terms: rows.results.map(mapTerm), total: Number(count?.total ?? 0) };
}

export async function getTerm(id: string) {
  await ensureTerminologySchema();
  const row = await getDb().prepare("SELECT * FROM terms WHERE id = ?").bind(id).first<TermRow>();
  return row ? mapTerm(row) : null;
}

export function terminologyDb() { return getDb(); }
