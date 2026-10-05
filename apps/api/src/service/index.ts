import type { Db } from "../db/connection.js";
import { createServiceContext } from "./context.js";
import { createLabelsService } from "./labels.js";
import { createMilestonesService } from "./milestones.js";
import { createProjectsService } from "./projects.js";

export { ServiceError } from "@linear-matti/shared";
export type { DbHandle, ServiceContext, Tx } from "./context.js";
export { allocateIssueNumber, ensureIssueKey } from "./issue-keys.js";
export type { Label } from "./labels.js";
export {
  attachLabels,
  detachLabels,
  listIssueLabels,
  setIssueLabels,
} from "./labels.js";
export type { Milestone } from "./milestones.js";
export type { Project } from "./projects.js";

/**
 * Builds the service container shared by REST and MCP. See context.ts for the
 * pattern and how to add a service.
 */
export function createServices(options: { db: Db; defaultIssueKey: string }) {
  const ctx = createServiceContext(options);
  return {
    projects: createProjectsService(ctx),
    milestones: createMilestonesService(ctx),
    labels: createLabelsService(ctx),
  };
}

export type Services = ReturnType<typeof createServices>;
