CREATE TABLE IF NOT EXISTS `workspace_attachments` (
  `id` text PRIMARY KEY NOT NULL,
  `scope` text NOT NULL,
  `brand` text DEFAULT '' NOT NULL,
  `product` text DEFAULT '' NOT NULL,
  `name` text NOT NULL,
  `content_type` text DEFAULT 'application/octet-stream' NOT NULL,
  `size` integer NOT NULL,
  `storage_key` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `workspace_attachments_storage_key_unique` ON `workspace_attachments` (`storage_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_workspace_attachments_scope_target` ON `workspace_attachments` (`scope`,`brand`,`product`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_templates` (
  `id` text PRIMARY KEY NOT NULL,
  `brand` text NOT NULL,
  `product` text NOT NULL,
  `title` text NOT NULL,
  `summary` text DEFAULT '' NOT NULL,
  `content` text NOT NULL,
  `attachment_id` text,
  `attachment_name` text,
  `attachment_size` integer,
  `created_by` text NOT NULL,
  `updated_by` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`attachment_id`) REFERENCES `workspace_attachments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_product_templates_target` ON `product_templates` (`brand`,`product`,`updated_at`);
