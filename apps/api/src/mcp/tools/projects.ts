import {
  deleteProjectToolShape,
  getProjectToolShape,
  listProjectsToolShape,
  ServiceError,
  saveProjectToolShape,
} from "@linear-matti/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Project } from "../../service/projects.js";
import type { McpContext } from "../server.js";
import {
  defineTool,
  explainPurgeDenied,
  paginate,
  resolveProjectRef,
} from "./helpers.js";
import { milestoneView } from "./milestones.js";
import { compactObject } from "./present.js";
import { mcpServices } from "./services.js";

const projectView = (
  p: Project,
  issueCounts: Record<string, number> | undefined,
) =>
  compactObject({
    id: p.id,
    key: p.key,
    name: p.name,
    status: p.status,
    issueCounts,
    deleted: p.deletedAt ? true : undefined,
  });

export function registerProjectTools(server: McpServer, ctx: McpContext) {
  const { projects, milestones, trash, stats } = mcpServices(ctx);

  defineTool(
    server,
    ctx,
    "list_projects",
    "List projects with issue counts per status.",
    listProjectsToolShape,
    (args) => {
      const query = args.query?.toLowerCase();
      const all = projects
        .list({ status: args.status, includeDeleted: args.includeDeleted })
        .filter(
          (p) =>
            !query ||
            p.name.toLowerCase().includes(query) ||
            p.key.toLowerCase().includes(query),
        );
      const page = paginate(
        all.map((p) => ({ id: p.id })),
        args,
      );
      const byId = new Map(all.map((p) => [p.id, p]));
      const counts = stats.issueCountsByProject(page.items.map((i) => i.id));
      return {
        ...page,
        items: page.items.map((i) =>
          projectView(byId.get(i.id) as Project, counts.get(i.id)),
        ),
      };
    },
  );

  defineTool(
    server,
    ctx,
    "get_project",
    "Get a project with its description and milestones (with progress).",
    getProjectToolShape,
    (args) => {
      const p = resolveProjectRef(projects, args.project);
      const view = projectView(p, stats.issueCountsByProject([p.id]).get(p.id));
      return compactObject({
        ...view,
        description: p.description,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        milestones:
          args.includeMilestones === false
            ? undefined
            : milestoneView(stats, milestones.list(p.id), { [p.id]: p }),
      });
    },
  );

  defineTool(
    server,
    ctx,
    "save_project",
    "Create a project (omit id; name required) or update one (with id). Key defaults to MAT and cannot change after creation.",
    saveProjectToolShape,
    (args) => {
      const { id, ...fields } = args;
      let saved: Project;
      if (id === undefined) {
        if (!fields.name) {
          throw new ServiceError(
            "validation_error",
            "name is required to create a project",
          );
        }
        saved = projects.create(ctx.actor, { ...fields, name: fields.name });
      } else {
        const current = resolveProjectRef(projects, id);
        if (fields.key !== undefined && fields.key !== current.key) {
          throw new ServiceError(
            "conflict",
            `Project key cannot be changed after creation (current key: ${current.key}).`,
          );
        }
        const { key: _key, ...patch } = fields;
        saved = projects.update(current.id, patch);
      }
      return {
        ...projectView(saved, undefined),
        description: saved.description,
      };
    },
  );

  defineTool(
    server,
    ctx,
    "delete_project",
    "Soft-delete a project (hides its milestones and issues); restorable with restore. purge=true permanently removes an ALREADY deleted project; only allowed for actor 'you' (or agents when ALLOW_AGENT_PURGE is on).",
    deleteProjectToolShape,
    async (args) => {
      const p = resolveProjectRef(projects, args.project, {
        includeDeleted: args.purge,
      });
      try {
        return {
          ...(await trash.delete(ctx.actor, "project", p.id, {
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
