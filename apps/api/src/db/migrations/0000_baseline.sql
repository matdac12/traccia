CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`actor` text NOT NULL,
	`type` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "activity_actor_check" CHECK(actor IN ('agent','you'))
);
--> statement-breakpoint
CREATE INDEX `activity_issue` ON `activity` (`issue_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`comment_id` text,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_key` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	`deleted_at` text,
	`deleted_batch` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attachments_actor_check" CHECK(actor IN ('agent','you'))
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`parent_id` text,
	`body` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`deleted_batch` text,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "comments_actor_check" CHECK(actor IN ('agent','you'))
);
--> statement-breakpoint
CREATE INDEX `comments_issue` ON `comments` (`issue_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `issue_keys` (
	`key` text PRIMARY KEY NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "issue_keys_key_format" CHECK("issue_keys"."key" GLOB '[A-Z][A-Z0-9]*' AND length("issue_keys"."key") BETWEEN 2 AND 8)
);
--> statement-breakpoint
CREATE TABLE `issue_labels` (
	`issue_id` text NOT NULL,
	`label_id` text NOT NULL,
	PRIMARY KEY(`issue_id`, `label_id`),
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `issue_relations` (
	`blocker_id` text NOT NULL,
	`blocked_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`blocker_id`, `blocked_id`),
	FOREIGN KEY (`blocker_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blocked_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issue_relations_no_self" CHECK("issue_relations"."blocker_id" <> "issue_relations"."blocked_id")
);
--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`number` integer NOT NULL,
	`identifier` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'backlog' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`estimate` integer,
	`assignee` text,
	`milestone_id` text,
	`parent_id` text,
	`sort_order` real DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`canceled_at` text,
	`deleted_at` text,
	`deleted_batch` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`key`) REFERENCES `issue_keys`(`key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issues_status_check" CHECK(status IN ('backlog','todo','in_progress','in_review','done','canceled')),
	CONSTRAINT "issues_priority_check" CHECK("issues"."priority" BETWEEN 0 AND 4),
	CONSTRAINT "issues_estimate_check" CHECK("issues"."estimate" IS NULL OR "issues"."estimate" >= 0),
	CONSTRAINT "issues_assignee_check" CHECK("issues"."assignee" IS NULL OR assignee IN ('agent','you')),
	CONSTRAINT "issues_created_by_check" CHECK(created_by IN ('agent','you'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issues_identifier_unique` ON `issues` (`identifier`);--> statement-breakpoint
CREATE UNIQUE INDEX `issues_key_number_unique` ON `issues` (`key`,`number`);--> statement-breakpoint
CREATE INDEX `issues_project_status` ON `issues` (`project_id`,`status`) WHERE "issues"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `issues_assignee` ON `issues` (`assignee`,`status`) WHERE "issues"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `issues_parent` ON `issues` (`parent_id`);--> statement-breakpoint
CREATE INDEX `issues_milestone` ON `issues` (`milestone_id`);--> statement-breakpoint
CREATE INDEX `issues_updated` ON `issues` (`updated_at`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#6b7280' NOT NULL,
	`project_id` text,
	`created_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `labels_unique_name` ON `labels` (COALESCE("project_id", ''),lower("name")) WHERE "labels"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`target_date` text,
	`sort_order` real DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`deleted_batch` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "milestones_created_by_check" CHECK(created_by IN ('agent','you'))
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`deleted_batch` text,
	FOREIGN KEY (`key`) REFERENCES `issue_keys`(`key`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "projects_status_check" CHECK(status IN ('active','paused','completed','canceled')),
	CONSTRAINT "projects_created_by_check" CHECK(created_by IN ('agent','you'))
);
--> statement-breakpoint
CREATE TABLE `tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`actor` text NOT NULL,
	`token_hash` text NOT NULL,
	`scopes` text DEFAULT 'all' NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	CONSTRAINT "tokens_actor_check" CHECK(actor IN ('agent','you'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_token_hash_unique` ON `tokens` (`token_hash`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `search_index` USING fts5(
	kind UNINDEXED,
	ref_id UNINDEXED,
	issue_id UNINDEXED,
	title,
	body,
	tokenize = 'porter unicode61 remove_diacritics 2'
);
