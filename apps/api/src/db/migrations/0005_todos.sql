CREATE TABLE `todo_references` (
	`todo_id` text NOT NULL,
	`project_id` text NOT NULL,
	PRIMARY KEY(`todo_id`, `project_id`),
	FOREIGN KEY (`todo_id`) REFERENCES `todos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `todos` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`day` text,
	`reminder_time` text,
	`reminder_status` text,
	`reminder_sent_at` text,
	`reminder_attempts` integer DEFAULT 0 NOT NULL,
	`reminder_next_attempt_at` text,
	`reminder_failure` text,
	`state` text DEFAULT 'open' NOT NULL,
	`closed_at` text,
	`parent_id` text,
	`position` real DEFAULT 0 NOT NULL,
	`details` text,
	`created_by` text NOT NULL,
	`created_by_token` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`deleted_batch` text,
	`deleted_by` text,
	FOREIGN KEY (`parent_id`) REFERENCES `todos`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "todos_state_check" CHECK(state IN ('open','done','dropped')),
	CONSTRAINT "todos_created_by_check" CHECK(created_by IN ('agent','you')),
	CONSTRAINT "todos_reminder_needs_day" CHECK("todos"."reminder_time" IS NULL OR "todos"."day" IS NOT NULL),
	CONSTRAINT "todos_reminder_status_iff_time" CHECK(("todos"."reminder_time" IS NULL) = ("todos"."reminder_status" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `todos_open_day` ON `todos` (`state`,`day`) WHERE "todos"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `todos_parent` ON `todos` (`parent_id`);--> statement-breakpoint
CREATE INDEX `todos_due` ON `todos` (`day`,`reminder_time`) WHERE "todos"."state" = 'open' AND "todos"."reminder_status" = 'pending' AND "todos"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `todos_closed` ON `todos` ("closed_at" desc,"id" desc) WHERE "todos"."state" <> 'open' AND "todos"."deleted_at" IS NULL;