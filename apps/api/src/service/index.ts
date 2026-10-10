import type { Db } from "../db/connection.js";
import type { AttachmentStorage } from "../storage/storage.js";
import { createActivityFeedService } from "./activity-feed.js";
import { createAttachmentsService } from "./attachments.js";
import { createCommentsService } from "./comments.js";
import { createServiceContext } from "./context.js";
import { createDocumentsService } from "./documents.js";
import { createIssueListService } from "./issue-list.js";
import { createIssuePositionService } from "./issue-position.js";
import { createIssuesService } from "./issues.js";
import { createLabelsService } from "./labels.js";
import { createMemoriesService } from "./memories.js";
import { createMilestonesService } from "./milestones.js";
import { createProjectsService } from "./projects.js";
import { createRelationsService } from "./relations.js";
import { createSearchService } from "./search.js";
import { createStatsService } from "./stats.js";
import { createTrashService } from "./trash.js";

export { ServiceError } from "@traccia/shared";
export type { ActivityFeedItem } from "./activity-feed.js";
export type { Attachment } from "./attachments.js";
export type { Comment, CommentThread } from "./comments.js";
export type { DbHandle, ServiceContext, Tx } from "./context.js";
export type { Document, DocumentRecord } from "./documents.js";
export { allocateIssueNumber, ensureIssueKey } from "./issue-keys.js";
export { buildIssueListQuery } from "./issue-list.js";
export type { Issue, IssueDetail, IssueUpdateHook } from "./issues.js";
export { recordActivity, resolveIssue } from "./issues.js";
export type { Label } from "./labels.js";
export {
  attachLabels,
  detachLabels,
  listIssueLabels,
  setIssueLabels,
} from "./labels.js";
export type { Memory } from "./memories.js";
export type { Milestone } from "./milestones.js";
export type { Project } from "./projects.js";
export type { IssueRelations, RelatedIssue } from "./relations.js";
export type { SearchResult, SnippetSegment } from "./search.js";
export {
  indexComment,
  indexDocument,
  indexIssue,
  indexMemory,
  rebuildSearchIndex,
  reindexIssues,
  reindexKnowledge,
  removeFromSearchIndex,
} from "./search-index.js";
export type {
  DeleteResult,
  PurgeResult,
  RestoreResult,
  TrashItem,
  TrashType,
} from "./trash.js";
export { softDeleteAttachment } from "./trash.js";

/**
 * Builds the service container shared by REST and MCP. See context.ts for the
 * pattern and how to add a service.
 */
export function createServices(options: {
  db: Db;
  defaultIssueKey: string;
  allowAgentPurge?: boolean;
  storage?: AttachmentStorage;
}) {
  const ctx = createServiceContext(options);
  return {
    projects: createProjectsService(ctx),
    issues: {
      ...createIssuesService(ctx),
      ...createIssueListService(ctx),
      ...createIssuePositionService(ctx),
    },
    milestones: createMilestonesService(ctx),
    relations: createRelationsService(ctx),
    comments: createCommentsService(ctx),
    labels: createLabelsService(ctx),
    trash: createTrashService(ctx),
    attachments: createAttachmentsService(ctx),
    memories: createMemoriesService(ctx),
    documents: createDocumentsService(ctx),
    search: createSearchService(ctx),
    stats: createStatsService(ctx),
    activityFeed: createActivityFeedService(ctx),
  };
}

export type Services = ReturnType<typeof createServices>;
