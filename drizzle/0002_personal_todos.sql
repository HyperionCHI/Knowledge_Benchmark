CREATE TABLE `todo_recurrence_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`frequency` text NOT NULL,
	`interval` integer DEFAULT 1 NOT NULL,
	`weekdays_json` text,
	`month_day` integer,
	`recurrence_mode` text DEFAULT 'calendar' NOT NULL,
	`rrule` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`max_occurrences` integer,
	`generated_count` integer DEFAULT 0 NOT NULL,
	`missed_policy` text DEFAULT 'latest_only' NOT NULL,
	`wait_for_completion` integer DEFAULT false NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`next_occurrence_date` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `todo_recurrence_templates_user_active_idx` ON `todo_recurrence_templates` (`user_id`,`deleted_at`,`paused`);
--> statement-breakpoint
CREATE TABLE `todo_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`recurrence_template_id` text,
	`source` text NOT NULL,
	`title` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`recurrence_template_id`) REFERENCES `todo_recurrence_templates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `todo_items_user_schedule_status_idx` ON `todo_items` (`user_id`,`scheduled_for`,`status`);
--> statement-breakpoint
CREATE INDEX `todo_items_user_source_idx` ON `todo_items` (`user_id`,`source`);
--> statement-breakpoint
CREATE UNIQUE INDEX `todo_items_template_schedule_unique` ON `todo_items` (`recurrence_template_id`,`scheduled_for`);
