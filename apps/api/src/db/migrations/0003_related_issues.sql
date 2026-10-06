CREATE TABLE `issue_related` (
	`issue_a_id` text NOT NULL,
	`issue_b_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`issue_a_id`, `issue_b_id`),
	FOREIGN KEY (`issue_a_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issue_b_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issue_related_no_self" CHECK("issue_related"."issue_a_id" <> "issue_related"."issue_b_id"),
	CONSTRAINT "issue_related_canonical" CHECK("issue_related"."issue_a_id" < "issue_related"."issue_b_id")
);
