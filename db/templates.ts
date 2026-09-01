import { initialTemplates } from "../app/sections/templates/initialTemplates";
import { attachments } from "./attachments";
import { getLocalDatabase } from "./local";

export type TemplateRow = {
  id: string;
  title: string;
  category_id: string;
  category: string;
  category_name: string;
  summary: string;
  content: string;
  attachment_key: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_size: number | null;
  created_at: string;
  updated_at: string;
};

export type TemplateCategoryRow = {
  id: string;
  name: string;
  description: string;
  color: string;
  template_count: number;
  created_at: string;
  updated_at: string;
};

export const templateCategorySeeds = [
  { id: "custom", name: "自定义", description: "团队自行维护的通用模板", color: "#59616d" },
];

export function getBindings() {
  return { DB: getLocalDatabase(), ATTACHMENTS: attachments };
}

export async function ensureTemplateSchema() {
  const { DB } = getBindings();
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS template_categories (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#124f9f',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_template_categories_name ON template_categories (name)"),
    DB.prepare("CREATE TABLE IF NOT EXISTS template_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)"),
    DB.prepare(`CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      category_id TEXT NOT NULL DEFAULT 'custom' REFERENCES template_categories(id) ON DELETE RESTRICT ON UPDATE CASCADE,
      category TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      attachment_key TEXT,
      attachment_name TEXT,
      attachment_type TEXT,
      attachment_size INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT ''
    )`),
  ]);

  const now = new Date().toISOString();
  await DB.batch(templateCategorySeeds.map((category) => DB.prepare(
    "INSERT OR IGNORE INTO template_categories (id, name, description, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(category.id, category.name, category.description, category.color, now, now)));

  const columns = await DB.prepare("PRAGMA table_info(templates)").all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "category_id")) await DB.prepare("ALTER TABLE templates ADD COLUMN category_id TEXT").run();
  if (!columns.results.some((column) => column.name === "updated_at")) await DB.prepare("ALTER TABLE templates ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''").run();

  await DB.batch([
    DB.prepare("CREATE INDEX IF NOT EXISTS templates_created_at_idx ON templates (created_at)"),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_templates_category_id ON templates (category_id)"),
    ...templateCategorySeeds.map((category) => DB.prepare("UPDATE templates SET category_id = ? WHERE category = ? AND (category_id IS NULL OR category_id = 'custom')").bind(category.id, category.name)),
  ]);

  const seeded = await DB.prepare("SELECT value FROM template_meta WHERE key = ?").bind("builtin_seed_version").first<{ value: string }>();
  if (!seeded) {
    await DB.batch(initialTemplates.map((template) => DB.prepare(`INSERT OR IGNORE INTO templates (
      id, title, category_id, category, summary, content, attachment_key, attachment_name, attachment_type, attachment_size, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`).bind(
      template.id, template.title, template.categoryId, template.category, template.summary, template.content, template.createdAt, template.updatedAt,
    )));
    await DB.prepare("INSERT OR REPLACE INTO template_meta (key, value) VALUES (?, ?)").bind("builtin_seed_version", "1").run();
  }
}

export function toTemplateRecord(row: TemplateRow) {
  return {
    id: row.id,
    title: row.title,
    categoryId: row.category_id,
    category: row.category_name || row.category,
    summary: row.summary,
    content: row.content,
    attachmentName: row.attachment_name,
    attachmentSize: row.attachment_size,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

export function toTemplateCategory(row: TemplateCategoryRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    templateCount: Number(row.template_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getTemplate(id: string) {
  await ensureTemplateSchema();
  const row = await getBindings().DB.prepare(`SELECT t.*, c.name AS category_name
    FROM templates t JOIN template_categories c ON c.id = t.category_id WHERE t.id = ?`).bind(id).first<TemplateRow>();
  return row ? toTemplateRecord(row) : null;
}
