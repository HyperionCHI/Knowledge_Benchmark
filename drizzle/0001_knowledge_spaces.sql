CREATE TABLE IF NOT EXISTS `knowledge_spaces` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `brand_id` text,
  `product_id` text,
  `title` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_knowledge_spaces_kind_product` ON `knowledge_spaces` (`kind`,`product_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_knowledge_spaces_brand` ON `knowledge_spaces` (`brand_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `knowledge_categories` (
  `id` text PRIMARY KEY NOT NULL,
  `space_id` text NOT NULL,
  `parent_id` text,
  `name` text NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`space_id`) REFERENCES `knowledge_spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_knowledge_categories_space_name` ON `knowledge_categories` (`space_id`,`name`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_knowledge_categories_space_sort` ON `knowledge_categories` (`space_id`,`sort_order`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `knowledge_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `space_id` text NOT NULL,
  `category_id` text NOT NULL,
  `title` text NOT NULL,
  `slug` text NOT NULL,
  `body` text NOT NULL,
  `items_json` text DEFAULT '[]' NOT NULL,
  `status` text DEFAULT 'published' NOT NULL,
  `created_by` text NOT NULL,
  `updated_by` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `version` integer DEFAULT 1 NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `deleted_at` text,
  FOREIGN KEY (`space_id`) REFERENCES `knowledge_spaces`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`category_id`) REFERENCES `knowledge_categories`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_knowledge_documents_space_slug` ON `knowledge_documents` (`space_id`,`slug`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_knowledge_documents_space_category_sort` ON `knowledge_documents` (`space_id`,`category_id`,`sort_order`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_knowledge_documents_active_updated` ON `knowledge_documents` (`deleted_at`,`updated_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `knowledge_document_assets` (
  `document_id` text NOT NULL,
  `attachment_id` text NOT NULL,
  `role` text DEFAULT 'attachment' NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`document_id`,`attachment_id`,`role`),
  FOREIGN KEY (`document_id`) REFERENCES `knowledge_documents`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`attachment_id`) REFERENCES `workspace_attachments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_knowledge_document_assets_attachment` ON `knowledge_document_assets` (`attachment_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `knowledge_document_collaborators` (
  `document_id` text NOT NULL,
  `user_id` text NOT NULL,
  `permission` text DEFAULT 'view' NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`document_id`,`user_id`),
  FOREIGN KEY (`document_id`) REFERENCES `knowledge_documents`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_knowledge_collaborators_user` ON `knowledge_document_collaborators` (`user_id`,`permission`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `workspace_attachment_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `attachment_id` text NOT NULL,
  `version` integer NOT NULL,
  `name` text NOT NULL,
  `content_type` text NOT NULL,
  `size` integer NOT NULL,
  `storage_key` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`attachment_id`) REFERENCES `workspace_attachments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `workspace_attachment_versions_storage_key_unique` ON `workspace_attachment_versions` (`storage_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_workspace_attachment_versions_number` ON `workspace_attachment_versions` (`attachment_id`,`version`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_workspace_attachment_versions_attachment` ON `workspace_attachment_versions` (`attachment_id`,`created_at`);
