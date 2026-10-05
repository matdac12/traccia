ALTER TABLE `attachments` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `issues` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `milestones` ADD `deleted_by` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `deleted_by` text;