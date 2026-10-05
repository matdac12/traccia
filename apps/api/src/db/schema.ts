import {
  ACTORS,
  type Actor,
  ISSUE_STATUSES,
  type IssueStatus,
  PROJECT_STATUSES,
  type ProjectStatus,
} from "@linear-matti/shared";
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Spec 6.3. The FTS5 table `search_index` (6.4) is virtual and lives only in
// the SQL migration; Drizzle does not model it.

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(",")})`);

const actorCheck = (name: string, column: string) =>
  check(name, inList(column, ACTORS));

export const issueKeys = sqliteTable(
  "issue_keys",
  {
    key: text("key").primaryKey(),
    nextNumber: integer("next_number").notNull().default(1),
  },
  (t) => [
    check(
      "issue_keys_key_format",
      sql`${t.key} GLOB '[A-Z][A-Z0-9]*' AND length(${t.key}) BETWEEN 2 AND 8`,
    ),
  ],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    key: text("key")
      .notNull()
      .references(() => issueKeys.key),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").$type<ProjectStatus>().notNull().default("active"),
    createdBy: text("created_by").$type<Actor>().notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
    deletedBatch: text("deleted_batch"),
  },
  () => [
    check("projects_status_check", inList("status", PROJECT_STATUSES)),
    actorCheck("projects_created_by_check", "created_by"),
  ],
);

export const milestones = sqliteTable(
  "milestones",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    targetDate: text("target_date"),
    sortOrder: real("sort_order").notNull().default(0),
    createdBy: text("created_by").$type<Actor>().notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
    deletedBatch: text("deleted_batch"),
  },
  () => [actorCheck("milestones_created_by_check", "created_by")],
);

export const issues = sqliteTable(
  "issues",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    key: text("key")
      .notNull()
      .references(() => issueKeys.key),
    number: integer("number").notNull(),
    identifier: text("identifier").notNull().unique(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").$type<IssueStatus>().notNull().default("backlog"),
    priority: integer("priority").notNull().default(0),
    estimate: integer("estimate"),
    assignee: text("assignee").$type<Actor>(),
    milestoneId: text("milestone_id").references(() => milestones.id),
    parentId: text("parent_id").references((): AnySQLiteColumn => issues.id),
    sortOrder: real("sort_order").notNull().default(0),
    createdBy: text("created_by").$type<Actor>().notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    canceledAt: text("canceled_at"),
    deletedAt: text("deleted_at"),
    deletedBatch: text("deleted_batch"),
  },
  (t) => [
    check("issues_status_check", inList("status", ISSUE_STATUSES)),
    check("issues_priority_check", sql`${t.priority} BETWEEN 0 AND 4`),
    check(
      "issues_estimate_check",
      sql`${t.estimate} IS NULL OR ${t.estimate} >= 0`,
    ),
    check(
      "issues_assignee_check",
      sql`${t.assignee} IS NULL OR ${inList("assignee", ACTORS)}`,
    ),
    actorCheck("issues_created_by_check", "created_by"),
    uniqueIndex("issues_key_number_unique").on(t.key, t.number),
    index("issues_project_status")
      .on(t.projectId, t.status)
      .where(sql`${t.deletedAt} IS NULL`),
    index("issues_assignee")
      .on(t.assignee, t.status)
      .where(sql`${t.deletedAt} IS NULL`),
    index("issues_parent").on(t.parentId),
    index("issues_milestone").on(t.milestoneId),
    index("issues_updated").on(t.updatedAt),
  ],
);

export const labels = sqliteTable(
  "labels",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    color: text("color").notNull().default("#6b7280"),
    projectId: text("project_id").references(() => projects.id),
    createdAt: text("created_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("labels_unique_name")
      .on(sql`COALESCE(${t.projectId}, '')`, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const issueLabels = sqliteTable(
  "issue_labels",
  {
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id),
    labelId: text("label_id")
      .notNull()
      .references(() => labels.id),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.labelId] })],
);

/** "blocker blocks blocked" */
export const issueRelations = sqliteTable(
  "issue_relations",
  {
    blockerId: text("blocker_id")
      .notNull()
      .references(() => issues.id),
    blockedId: text("blocked_id")
      .notNull()
      .references(() => issues.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    check("issue_relations_no_self", sql`${t.blockerId} <> ${t.blockedId}`),
  ],
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id),
    parentId: text("parent_id").references((): AnySQLiteColumn => comments.id),
    body: text("body").notNull(),
    actor: text("actor").$type<Actor>().notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
    deletedBatch: text("deleted_batch"),
  },
  (t) => [
    actorCheck("comments_actor_check", "actor"),
    index("comments_issue").on(t.issueId, t.createdAt),
  ],
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id),
    commentId: text("comment_id").references(() => comments.id),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    actor: text("actor").$type<Actor>().notNull(),
    createdAt: text("created_at").notNull(),
    deletedAt: text("deleted_at"),
    deletedBatch: text("deleted_batch"),
  },
  () => [actorCheck("attachments_actor_check", "actor")],
);

export const activity = sqliteTable(
  "activity",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id),
    actor: text("actor").$type<Actor>().notNull(),
    type: text("type").notNull(),
    data: text("data").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    actorCheck("activity_actor_check", "actor"),
    index("activity_issue").on(t.issueId, t.createdAt),
  ],
);

export const tokens = sqliteTable(
  "tokens",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    actor: text("actor").$type<Actor>().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    scopes: text("scopes").notNull().default("all"),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
  },
  () => [actorCheck("tokens_actor_check", "actor")],
);
