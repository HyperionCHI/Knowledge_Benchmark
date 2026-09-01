CREATE TABLE `todo_organization_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`audience_type` text NOT NULL,
	`frequency` text NOT NULL,
	`interval` integer DEFAULT 1 NOT NULL,
	`weekdays_json` text DEFAULT '[]' NOT NULL,
	`month_day` integer,
	`rrule` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`max_occurrences` integer,
	`generated_count` integer DEFAULT 0 NOT NULL,
	`missed_policy` text DEFAULT 'latest_only' NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`next_occurrence_date` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_todo_org_templates_active` ON `todo_organization_templates` (`archived_at`,`paused`,`next_occurrence_date`);
--> statement-breakpoint
CREATE TABLE `todo_organization_template_recipients` (
	`template_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`template_id`, `user_id`),
	FOREIGN KEY (`template_id`) REFERENCES `todo_organization_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_todo_org_template_recipients_user` ON `todo_organization_template_recipients` (`user_id`,`template_id`);
--> statement-breakpoint
CREATE TABLE `todo_organization_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`audience_type` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `todo_organization_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_todo_org_occurrence_schedule` ON `todo_organization_occurrences` (`template_id`,`scheduled_for`);
--> statement-breakpoint
CREATE INDEX `idx_todo_org_occurrence_date` ON `todo_organization_occurrences` (`scheduled_for`,`status`);
--> statement-breakpoint
CREATE TABLE `todo_organization_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`occurrence_id` text NOT NULL,
	`user_id` text NOT NULL,
	`user_name_snapshot` text NOT NULL,
	`username_snapshot` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`occurrence_id`) REFERENCES `todo_organization_occurrences`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_todo_org_assignment_user` ON `todo_organization_assignments` (`occurrence_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_todo_org_assignment_dashboard` ON `todo_organization_assignments` (`user_id`,`status`,`occurrence_id`);
--> statement-breakpoint
CREATE INDEX `idx_todo_org_assignment_progress` ON `todo_organization_assignments` (`occurrence_id`,`status`);
