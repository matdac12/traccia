import type { Db } from "../db/connection.js";
import { createServiceContext } from "./context.js";
import { createIssuesService } from "./issues.js";
import { createMilestonesService } from "./milestones.js";
import { createProjectsService } from "./projects.js";
import { createRelationsService } from "./relations.js";

export { ServiceError } from "@linear-matti/shared";
export type { DbHandle, ServiceContext, Tx } from "./context.js";
export { allocateIssueNumber, ensureIssueKey } from "./issue-keys.js";
export type { Issue, IssueDetail, IssueUpdateHook } from "./issues.js";
export { recordActivity, resolveIssue } from "./issues.js";
export type { Milestone } from "./milestones.js";
export type { Project } from "./projects.js";
export type { IssueRelations, RelatedIssue } from "./relations.js";

/**
 * Builds the service container shared by REST and MCP. See context.ts for the
 * pattern and how to add a service.
 */
export function createServices(options: { db: Db; defaultIssueKey: string }) {
  const ctx = createServiceContext(options);
  return {
    projects: createProjectsService(ctx),
    issues: createIssuesService(ctx),
    milestones: createMilestonesService(ctx),
    relations: createRelationsService(ctx),
  };
}

export type Services = ReturnType<typeof createServices>;
