import {
  deleteMilestoneToolShape,
  PURGE_NOTE,
  listMilestonesToolShape,
  ServiceError,
  saveMilestoneToolShape,
} from "@traccia/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Services } from "../../service/index.js";
import type { Milestone } from "../../service/milestones.js";
import type { Project } from "../../service/projects.js";
import type { McpContext } from "../server.js";
import {
  defineTool,
  explainPurgeDenied,
  paginate,
  resolveProjectRef,
} from "./helpers.js";
import { compactObject } from "./present.js";
import { mcpServices } from "./services.js";

/** Milestone rows as tool output: project name, progress, `deleted` flag. */
export function milestoneView(
  stats: Services["stats"],
  rows: Milestone[],
  projects: Record<string, Project>,
  options: { withDescription?: boolean } = {},
) {
  const progress = stats.progressByMilestone(rows.map((m) => m.id));
  return rows.map((m) =>
    compactObject({
      id: m.id,
      project: projects[m.projectId]?.name,
      name: m.name,
      description: options.withDescription ? m.description : undefined,
      targetDate: m.targetDate,
      progress: progress.get(m.id),
      deleted: m.deletedAt ? true : undefined,
    }),
  );
}

export function registerMilestoneTools(server: McpServer, ctx: McpContext) {
  const { projects, milestones, trash, stats } = mcpServices(ctx);
  const projectsById = (includeDeleted?: boolean) =>
    Object.fromEntries(projects.list({ includeDeleted }).map((p) => [p.id, p]));

  defineTool(
    server,
    ctx,
    "list_milestones",
    "List milestones (all projects, or one) with progress {done,total}; canceled issues excluded.",
    listMilestonesToolShape,
    (args) => {
      const byId = projectsById(args.includeDeleted);
      const scope = args.project
        ? [
            resolveProjectRef(projects, args.project, {
              includeDeleted: args.includeDeleted,
            }),
          ]
        : Object.values(byId);
      const rows = scope.flatMap((p) =>
        milestones.list(p.id, { includeDeleted: args.includeDeleted }),
      );
      const page = paginate(
        rows.map((m) => ({ id: m.id })),
        args,
      );
      const wanted = new Set(page.items.map((i) => i.id));
      return {
        ...page,
        items: milestoneView(
          stats,
          rows.filter((m) => wanted.has(m.id)),
          byId,
        ),
      };
    },
  );

  defineTool(
    server,
    ctx,
    "save_milestone",
    "Create a milestone (omit id; project and name required) or update one (with id). targetDate is YYYY-MM-DD, null clears.",
    saveMilestoneToolShape,
    (args) => {
      const { id, project, ...fields } = args;
      let saved: Milestone;
      if (id === undefined) {
        if (!project || !fields.name) {
          throw new ServiceError(
            "validation_error",
            "project and name are required to create a milestone",
          );
        }
        saved = milestones.create(
          ctx.actor,
          resolveProjectRef(projects, project).id,
          {
            ...fields,
            name: fields.name,
          },
        );
      } else {
        if (project !== undefined) {
          throw new ServiceError(
            "validation_error",
            "A milestone cannot be moved to another project; omit project when updating.",
          );
        }
        saved = milestones.update(id, fields);
      }
      return milestoneView(stats, [saved], projectsById(true), {
        withDescription: true,
      })[0] as Record<string, unknown>;
    },
  );

  defineTool(
    server,
    ctx,
    "delete_milestone",
    `Soft-delete a milestone; its issues are kept with milestone cleared (restorable via restore). ${PURGE_NOTE}`,
    deleteMilestoneToolShape,
    async (args) => {
      try {
        return {
          ...(await trash.delete(ctx.actor, "milestone", args.id, {
            purge: args.purge,
          })),
        };
      } catch (err) {
        if (args.purge) explainPurgeDenied(err);
        throw err;
      }
    },
  );
}
