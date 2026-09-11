import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const templateCategories = sqliteTable(
  "template_categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    color: text("color").notNull().default("#124f9f"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_template_categories_name").on(table.name)],
);

export const templates = sqliteTable(
  "templates",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    categoryId: text("category_id").notNull().default("custom").references(() => templateCategories.id, { onDelete: "restrict", onUpdate: "cascade" }),
    category: text("category").notNull(),
    summary: text("summary").notNull().default(""),
    content: text("content").notNull(),
    attachmentKey: text("attachment_key"),
    attachmentName: text("attachment_name"),
    attachmentType: text("attachment_type"),
    attachmentSize: integer("attachment_size"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull().default(""),
  },
  (table) => [index("templates_created_at_idx").on(table.createdAt), index("idx_templates_category_id").on(table.categoryId)],
);

export const templateMeta = sqliteTable("template_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const termCategories = sqliteTable(
  "term_categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    color: text("color").notNull().default("#124f9f"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_term_categories_name").on(table.name)],
);

export const terms = sqliteTable(
  "terms",
  {
    id: text("id").primaryKey(),
    categoryId: text("category_id").notNull().references(() => termCategories.id, { onDelete: "restrict", onUpdate: "cascade" }),
    chinese: text("chinese").notNull(),
    abbreviation: text("abbreviation").notNull().default(""),
    english: text("english").notNull().default(""),
    sortInitial: text("sort_initial").notNull().default("#"),
    definition: text("definition").notNull(),
    scenario: text("scenario").notNull().default(""),
    source: text("source").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_terms_category_id").on(table.categoryId),
    index("idx_terms_chinese").on(table.chinese),
    index("idx_terms_sort_initial").on(table.sortInitial),
    index("idx_terms_updated_at").on(table.updatedAt),
  ],
);

export const terminologyMeta = sqliteTable("terminology_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const workspaceAttachments = sqliteTable(
  "workspace_attachments",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull(),
    brand: text("brand").notNull().default(""),
    product: text("product").notNull().default(""),
    documentId: text("document_id").notNull().default(""),
    name: text("name").notNull(),
    contentType: text("content_type").notNull().default("application/octet-stream"),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_workspace_attachments_scope_target").on(table.scope, table.brand, table.product),
    index("idx_workspace_attachments_document").on(table.documentId, table.scope, table.createdAt),
  ],
);

export const knowledgeSpaces = sqliteTable(
  "knowledge_spaces",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["general", "sop"] }).notNull(),
    brandId: text("brand_id"),
    productId: text("product_id"),
    title: text("title").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_knowledge_spaces_kind_product").on(table.kind, table.productId),
    index("idx_knowledge_spaces_brand").on(table.brandId),
  ],
);

export const knowledgeCategories = sqliteTable(
  "knowledge_categories",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull().references(() => knowledgeSpaces.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_knowledge_categories_space_name").on(table.spaceId, table.name),
    index("idx_knowledge_categories_space_sort").on(table.spaceId, table.sortOrder),
  ],
);

export const knowledgeDocuments = sqliteTable(
  "knowledge_documents",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull().references(() => knowledgeSpaces.id, { onDelete: "cascade" }),
    categoryId: text("category_id").notNull().references(() => knowledgeCategories.id, { onDelete: "restrict", onUpdate: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    body: text("body").notNull(),
    itemsJson: text("items_json").notNull().default("[]"),
    status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("published"),
    treeIcon: text("tree_icon").notNull().default("docs"),
    treeIconColor: text("tree_icon_color").notNull().default("#53617b"),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    version: integer("version").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("idx_knowledge_documents_space_slug").on(table.spaceId, table.slug),
    index("idx_knowledge_documents_space_category_sort").on(table.spaceId, table.categoryId, table.sortOrder),
    index("idx_knowledge_documents_active_updated").on(table.deletedAt, table.updatedAt),
  ],
);

export const knowledgeDocumentAssets = sqliteTable(
  "knowledge_document_assets",
  {
    documentId: text("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    attachmentId: text("attachment_id").notNull().references(() => workspaceAttachments.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["attachment", "inline", "cover", "source"] }).notNull().default("attachment"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.attachmentId, table.role] }),
    index("idx_knowledge_document_assets_attachment").on(table.attachmentId),
  ],
);

export const knowledgeDocumentCollaborators = sqliteTable(
  "knowledge_document_collaborators",
  {
    documentId: text("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    permission: text("permission", { enum: ["view", "edit"] }).notNull().default("view"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.userId] }),
    index("idx_knowledge_collaborators_user").on(table.userId, table.permission),
  ],
);

export const workspaceAttachmentVersions = sqliteTable(
  "workspace_attachment_versions",
  {
    id: text("id").primaryKey(),
    attachmentId: text("attachment_id").notNull().references(() => workspaceAttachments.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_workspace_attachment_versions_number").on(table.attachmentId, table.version),
    index("idx_workspace_attachment_versions_attachment").on(table.attachmentId, table.createdAt),
  ],
);

export const productTemplates = sqliteTable(
  "product_templates",
  {
    id: text("id").primaryKey(),
    brand: text("brand").notNull(),
    product: text("product").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    content: text("content").notNull(),
    attachmentId: text("attachment_id").references(() => workspaceAttachments.id, { onDelete: "set null" }),
    attachmentName: text("attachment_name"),
    attachmentSize: integer("attachment_size"),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_product_templates_target").on(table.brand, table.product, table.updatedAt)],
);

export const todoRecurrenceTemplates = sqliteTable(
  "todo_recurrence_templates",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    frequency: text("frequency", { enum: ["daily", "weekly", "monthly"] }).notNull(),
    interval: integer("interval").notNull().default(1),
    weekdaysJson: text("weekdays_json").notNull().default("[]"),
    monthDay: integer("month_day"),
    recurrenceMode: text("recurrence_mode", { enum: ["calendar", "after_completion"] }).notNull().default("calendar"),
    rrule: text("rrule").notNull(),
    timezone: text("timezone").notNull().default("Asia/Shanghai"),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    maxOccurrences: integer("max_occurrences"),
    generatedCount: integer("generated_count").notNull().default(0),
    missedPolicy: text("missed_policy", { enum: ["latest_only", "all", "skip"] }).notNull().default("latest_only"),
    waitForCompletion: integer("wait_for_completion", { mode: "boolean" }).notNull().default(false),
    paused: integer("paused", { mode: "boolean" }).notNull().default(false),
    nextOccurrenceDate: text("next_occurrence_date"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("idx_todo_templates_user_active").on(table.userId, table.deletedAt, table.paused),
    index("idx_todo_templates_user_next").on(table.userId, table.nextOccurrenceDate),
  ],
);

export const todoItems = sqliteTable(
  "todo_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    recurrenceTemplateId: text("recurrence_template_id").references(() => todoRecurrenceTemplates.id, { onDelete: "set null" }),
    source: text("source", { enum: ["temporary", "recurring"] }).notNull(),
    title: text("title").notNull(),
    scheduledFor: text("scheduled_for").notNull(),
    status: text("status", { enum: ["pending", "completed", "skipped"] }).notNull().default("pending"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_todo_items_template_occurrence").on(table.recurrenceTemplateId, table.scheduledFor),
    index("idx_todo_items_user_status_due").on(table.userId, table.status, table.scheduledFor),
    index("idx_todo_items_user_completed").on(table.userId, table.completedAt),
    index("idx_todo_items_user_source").on(table.userId, table.source, table.scheduledFor),
  ],
);

export const todoOrganizationTemplates = sqliteTable(
  "todo_organization_templates",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    createdBy: text("created_by").notNull(),
    audienceType: text("audience_type", { enum: ["all", "custom"] }).notNull(),
    frequency: text("frequency", { enum: ["daily", "weekly", "monthly"] }).notNull(),
    interval: integer("interval").notNull().default(1),
    weekdaysJson: text("weekdays_json").notNull().default("[]"),
    monthDay: integer("month_day"),
    rrule: text("rrule").notNull(),
    timezone: text("timezone").notNull().default("Asia/Shanghai"),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    maxOccurrences: integer("max_occurrences"),
    generatedCount: integer("generated_count").notNull().default(0),
    missedPolicy: text("missed_policy", { enum: ["latest_only", "all", "skip"] }).notNull().default("latest_only"),
    paused: integer("paused", { mode: "boolean" }).notNull().default(false),
    nextOccurrenceDate: text("next_occurrence_date"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [index("idx_todo_org_templates_active").on(table.archivedAt, table.paused, table.nextOccurrenceDate)],
);

export const todoOrganizationTemplateRecipients = sqliteTable(
  "todo_organization_template_recipients",
  {
    templateId: text("template_id").notNull().references(() => todoOrganizationTemplates.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.templateId, table.userId] }),
    index("idx_todo_org_template_recipients_user").on(table.userId, table.templateId),
  ],
);

export const todoOrganizationOccurrences = sqliteTable(
  "todo_organization_occurrences",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id").notNull().references(() => todoOrganizationTemplates.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    audienceType: text("audience_type", { enum: ["all", "custom"] }).notNull(),
    scheduledFor: text("scheduled_for").notNull(),
    status: text("status", { enum: ["active", "cancelled"] }).notNull().default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_todo_org_occurrence_schedule").on(table.templateId, table.scheduledFor),
    index("idx_todo_org_occurrence_date").on(table.scheduledFor, table.status),
  ],
);

export const todoOrganizationAssignments = sqliteTable(
  "todo_organization_assignments",
  {
    id: text("id").primaryKey(),
    occurrenceId: text("occurrence_id").notNull().references(() => todoOrganizationOccurrences.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    userNameSnapshot: text("user_name_snapshot").notNull(),
    usernameSnapshot: text("username_snapshot").notNull().default(""),
    status: text("status", { enum: ["pending", "completed", "exempt"] }).notNull().default("pending"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_todo_org_assignment_user").on(table.occurrenceId, table.userId),
    index("idx_todo_org_assignment_dashboard").on(table.userId, table.status, table.occurrenceId),
    index("idx_todo_org_assignment_progress").on(table.occurrenceId, table.status),
  ],
);

// Better Auth tables. Kept in the same SQLite database so a local deployment
// can be moved to an internal server with its accounts and sessions intact.
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  username: text("username").unique(),
  displayUsername: text("display_username"),
  role: text("role").notNull().default("viewer"),
  banned: integer("banned", { mode: "boolean" }).notNull().default(false),
  banReason: text("ban_reason"),
  banExpires: integer("ban_expires", { mode: "timestamp" }),
});

export const workspaceScopePermissions = sqliteTable(
  "workspace_scope_permissions",
  {
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    scopeType: text("scope_type", { enum: ["all", "brand", "product"] }).notNull(),
    scopeId: text("scope_id").notNull(),
    permission: text("permission", { enum: ["none", "view", "edit"] }).notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.scopeType, table.scopeId] }),
    index("idx_workspace_scope_permissions_user").on(table.userId, table.permission),
  ],
);

export const workspaceGeneralPermissions = sqliteTable("workspace_general_permissions", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  permission: text("permission", { enum: ["view", "edit"] }).notNull().default("view"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonated_by"),
}, (table) => [index("idx_session_user_id").on(table.userId)]);

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"), refreshToken: text("refresh_token"), idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"), password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => [index("idx_account_user_id").on(table.userId)]);

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }), updatedAt: integer("updated_at", { mode: "timestamp" }),
}, (table) => [index("idx_verification_identifier").on(table.identifier)]);
