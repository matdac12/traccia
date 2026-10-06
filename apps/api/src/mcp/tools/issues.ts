import {
  type Actor,
  mcpPaginationShape,
  PURGE_NOTE,
  ServiceError,
} from "@traccia/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { canPurge } from "../../auth/permissions.js";
import type { Db } from "../../db/connection.js";
import { milestones } from "../../db/schema.js";
import { type IssueUpdateHook, resolveIssue } from "../../service/issues.js";
import { resolveProject } from "../../service/projects.js";
import { loadRelations, setBlockersTx } from "../../service/relations.js";
import { resolveUpdatedAfter } from "../duration.js";
import { toolError, toolResult } from "../errors.js";
import { PURGE_DENIED_MESSAGE } from "./helpers.js";
import type { McpContext } from "../server.js";
import {
  attachmentsByComment,
  compactIssue,
  compactIssues,
  compactObject,
  loadRefs,
  presentAttachment,
  presentComment,
} from "./present.js";
import { runLogged } from "./run.js";
import { mcpServices } from "./services.js";

const STATUS_HELP =
  "Backlog, Todo, In Progress, In Review, Done or Canceled (case-insensitive; in_progress style ok).";
const PRIORITY_HELP = "0/none, 1/urgent, 2/high, 3/medium, 4/low.";

const status = z.string();
const priority = z
  .union([z.number().int(), z.string()])
  .describe(PRIORITY_HELP);
const oneOrMany = <T extends z.ZodType>(t: T) => z.union([t, z.array(t)]);

const INCLUDES = [
  "comments",
  "attachments",
  "activity",
  "children",
  "relations",
] as const;

/** Milestone by name or id inside one project; the error lists what exists. */
function resolveMilestoneRef(db: Db, projectId: string, ref: string): string {
  const rows = db
    .select()
    .from(milestones)
    .where(
      and(eq(milestones.projectId, projectId), isNull(milestones.deletedAt)),
    )
    .all();
  const hit =
    rows.find((m) => m.id === ref) ??
    rows.find((m) => m.name.toLowerCase() === ref.toLowerCase());
  if (!hit) {
    throw new ServiceError(
      "not_found",
      `Unknown milestone '${ref}' in this project. ${
        rows.length
          ? `Existing milestones: ${rows.map((m) => m.name).join(", ")}.`
          : "The project has no milestones."
      }`,
    );
  }
  return hit.id;
}

/** Re-throws a stale-write conflict with the timestamp the caller needs. */
function explainConflict(err: unknown): never {
  if (err instanceof ServiceError && err.code === "conflict") {
    const current = (err.details as { currentUpdatedAt?: string } | undefined)
      ?.currentUpdatedAt;
    if (current) {
      throw new ServiceError(
        "conflict",
        `${err.message} (current updatedAt: ${current}). Re-read it with get_issue and retry with that expectedUpdatedAt.`,
        err.details,
      );
    }
  }
  throw err;
}

export function registerIssueTools(server: McpServer, ctx: McpContext) {
  const { db } = ctx.container;
  const actor: Actor = ctx.actor;
  const services = mcpServices(ctx);

  server.registerTool(
    "list_issues",
    {
      description:
        "List issues, newest update first, as compact items (get_issue for full text). Filters AND together; status values OR; a label array needs ALL labels. Page with nextCursor.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Full-text search (titles, descriptions, comments)."),
        project: z.string().optional().describe("Project key, name or id."),
        status: oneOrMany(status).optional().describe(STATUS_HELP),
        assignee: z.enum(["agent", "you", "none"]).optional(),
        label: oneOrMany(z.string())
          .optional()
          .describe("Label name(s); all required."),
        milestone: z.string().optional().describe("Milestone name or id."),
        parentId: z.string().optional().describe("Sub-issues of this issue."),
        priority: priority.optional(),
        createdBy: z.enum(["agent", "you"]).optional(),
        updatedAfter: z
          .string()
          .optional()
          .describe("ISO 8601 timestamp or duration like -P1D."),
        includeDeleted: z.boolean().optional(),
        orderBy: z
          .enum(["updatedAt", "createdAt", "priority", "sortOrder", "title"])
          .optional()
          .describe("Default updatedAt."),
        ...mcpPaginationShape,
      },
    },
    (args) =>
      runLogged(ctx, "list_issues", () => {
        const { query, parentId, updatedAfter, ...rest } = args;
        const page = services.issues.list({
          ...rest,
          q: query,
          parent: parentId,
          updatedAfter: updatedAfter
            ? resolveUpdatedAfter(updatedAfter)
            : undefined,
        });
        return toolResult({
          items: compactIssues(db, page.items),
          nextCursor: page.nextCursor,
        });
      }),
  );

  server.registerTool(
    "get_issue",
    {
      description:
        "Get one issue with its full markdown description. `include` defaults to comments, attachments, children, relations; add 'activity' for the change log.",
      inputSchema: {
        id: z.string().describe("Issue identifier (ABC-123)."),
        include: z.array(z.enum(INCLUDES)).optional(),
      },
    },
    ({ id, include = ["comments", "attachments", "children", "relations"] }) =>
      runLogged(ctx, "get_issue", () => {
        const issue = services.issues.get(id, include);
        const refs = loadRefs(db, [issue, ...issue.children]);
        const withAttachments = attachmentsByComment(db, issue.id);
        const flat = issue.comments.flatMap(({ replies, ...top }) => [
          top,
          ...replies,
        ]);
        const base = compactIssue(issue, refs);
        // Full text replaces the list snippet.
        const { descriptionSnippet: _s, ...item } = base;
        return toolResult(
          compactObject({
            ...item,
            description: issue.description,
            createdBy: issue.createdBy,
            createdAt: issue.createdAt,
            startedAt: issue.startedAt,
            completedAt: issue.completedAt,
            canceledAt: issue.canceledAt,
            comments: include.includes("comments")
              ? flat.map((c) =>
                  presentComment(c, withAttachments.get(c.id) ?? []),
                )
              : undefined,
            attachments: include.includes("attachments")
              ? issue.attachments.map(presentAttachment)
              : undefined,
            children: include.includes("children")
              ? issue.children.map((c) => compactIssue(c, refs))
              : undefined,
            relations: include.includes("relations")
              ? {
                  blockedBy: issue.relations.blockedBy.map(relationItem),
                  blocks: issue.relations.blocks.map(relationItem),
                }
              : undefined,
            activity: include.includes("activity")
              ? issue.activity.map((a) => ({
                  type: a.type,
                  actor: a.actor,
                  data: JSON.parse(a.data) as unknown,
                  createdAt: a.createdAt,
                }))
              : undefined,
          }),
        );
      }),
  );

  server.registerTool(
    "save_issue",
    {
      description:
        "Create (no id; needs title + project) or update (with id; only given fields change). `labels`, `blockedBy`, `blocks` REPLACE the whole set; labels must exist (save_issue_label). `project` on update moves the issue (identifier kept; parent/milestone reset). expectedUpdatedAt fails on concurrent edits.",
      inputSchema: {
        id: z.string().optional(),
        title: z.string().optional(),
        project: z.string().optional().describe("Project key, name or id."),
        description: z
          .string()
          .optional()
          .describe("Markdown; replaces the whole text."),
        status: status.optional().describe(`${STATUS_HELP} Default: Backlog.`),
        priority: priority.optional(),
        estimate: z.number().int().min(0).nullable().optional(),
        assignee: z
          .enum(["agent", "you"])
          .nullable()
          .optional()
          .describe("null unassigns."),
        labels: z.array(z.string()).optional(),
        milestone: z
          .string()
          .nullable()
          .optional()
          .describe("Milestone name or id; null clears."),
        parentId: z
          .string()
          .nullable()
          .optional()
          .describe("Parent issue (same project); null detaches."),
        blockedBy: z
          .array(z.string())
          .optional()
          .describe("Issues blocking this one."),
        blocks: z
          .array(z.string())
          .optional()
          .describe("Issues this one blocks."),
        expectedUpdatedAt: z.string().optional(),
      },
    },
    (args) =>
      runLogged(ctx, "save_issue", () => {
        const { id, milestone, blockedBy, blocks, ...fields } = args;
        try {
          return id
            ? updateIssue(id, fields, milestone, blockedBy, blocks)
            : createIssue(fields, milestone, blockedBy, blocks);
        } catch (err) {
          return explainConflict(err);
        }
      }),
  );

  type Fields = {
    title?: string;
    project?: string;
    description?: string;
    status?: string;
    priority?: string | number;
    estimate?: number | null;
    assignee?: "agent" | "you" | null;
    labels?: string[];
    parentId?: string | null;
    expectedUpdatedAt?: string;
  };

  function createIssue(
    fields: Fields,
    milestone: string | null | undefined,
    blockedBy: string[] | undefined,
    blocks: string[] | undefined,
  ) {
    const {
      title,
      project: projectRef,
      labels,
      expectedUpdatedAt,
      ...rest
    } = fields;
    if (!title || !projectRef) {
      return toolError(
        "Creating an issue requires 'title' and 'project' (key, name, or id). To update an existing issue pass its 'id'.",
      );
    }
    if (expectedUpdatedAt) {
      return toolError(
        "expectedUpdatedAt only applies when updating (with 'id').",
      );
    }
    // Validate everything that can fail before writing, so a bad label or
    // blocker never leaves a half-created issue behind.
    const project = resolveProject(db, projectRef);
    const milestoneId = milestone
      ? resolveMilestoneRef(db, project.id, milestone)
      : undefined;
    if (labels?.length) {
      const known = services.labels.list({ project: project.id });
      const names = new Set(known.map((l) => l.name.toLowerCase()));
      const bad = labels.find((l) => !names.has(l.trim().toLowerCase()));
      if (bad !== undefined) {
        const existing = [...new Set(known.map((l) => l.name))];
        throw new ServiceError(
          "validation_error",
          `Unknown label '${bad}'. ${
            existing.length
              ? `Existing labels: ${existing.join(", ")}.`
              : "No labels exist yet."
          } Use save_issue_label to create one.`,
        );
      }
    }
    for (const ref of [...(blockedBy ?? []), ...(blocks ?? [])]) {
      resolveIssue(db, ref);
    }
    const created = services.issues.create(actor, {
      ...rest,
      title,
      project: projectRef,
      milestoneId,
    });
    if (labels?.length || blockedBy?.length || blocks?.length) {
      // Labels and blockers attach in one transaction.
      services.issues.update(
        actor,
        created.identifier,
        { labels },
        blockedBy || blocks ? blockersHook(blockedBy, blocks) : undefined,
      );
    }
    return presentSaved(created.identifier, !!(blockedBy || blocks));
  }

  function updateIssue(
    id: string,
    fields: Fields,
    milestone: string | null | undefined,
    blockedBy: string[] | undefined,
    blocks: string[] | undefined,
  ) {
    const issue = resolveIssue(db, id);
    const project = fields.project
      ? resolveProject(db, fields.project)
      : undefined;
    const milestoneId =
      milestone === undefined || milestone === null
        ? milestone
        : resolveMilestoneRef(db, project?.id ?? issue.projectId, milestone);
    const { title, ...rest } = fields;
    for (const ref of [...(blockedBy ?? []), ...(blocks ?? [])]) {
      if (resolveIssue(db, ref).id === issue.id) {
        throw new ServiceError(
          "validation_error",
          "An issue cannot block itself",
        );
      }
    }
    // Fields, labels, blocker sets, project move and the optimistic-concurrency
    // check commit atomically: any failure leaves the issue untouched.
    services.issues.update(
      actor,
      issue.identifier,
      { ...rest, title, milestoneId },
      blockersHook(blockedBy, blocks),
    );
    return presentSaved(issue.identifier, !!(blockedBy || blocks));
  }

  /** Update hook that syncs blocker sets in the update transaction, if given. */
  function blockersHook(
    blockedBy: string[] | undefined,
    blocks: string[] | undefined,
  ): IssueUpdateHook | undefined {
    if (blockedBy === undefined && blocks === undefined) return undefined;
    return (tx, updated, by) =>
      setBlockersTx(tx, by, updated.id, { blockedBy, blocks });
  }

  function presentSaved(identifier: string, withRelations: boolean) {
    const fresh = resolveIssue(db, identifier);
    const relations = withRelations
      ? (() => {
          const r = loadRelations(db, fresh.id);
          return {
            blockedBy: r.blockedBy.map(relationItem),
            blocks: r.blocks.map(relationItem),
          };
        })()
      : undefined;
    return toolResult(
      compactObject({
        ...compactIssue(fresh, loadRefs(db, [fresh])),
        relations,
      }),
    );
  }

  server.registerTool(
    "delete_issue",
    {
      description: `Soft-delete an issue with its sub-issues, comments and attachments (restorable via restore). ${PURGE_NOTE}`,
      inputSchema: {
        id: z.string().describe("Issue identifier."),
        purge: z.boolean().optional(),
      },
    },
    ({ id, purge }) =>
      runLogged(ctx, "delete_issue", async () => {
        if (purge && !canPurge(actor, ctx.container.config)) {
          return toolError(PURGE_DENIED_MESSAGE);
        }
        const result = await services.trash.delete(actor, "issue", id, {
          purge: purge ?? false,
        });
        return toolResult({ ...result });
      }),
  );
}

function relationItem(r: {
  identifier: string;
  title: string;
  status: string;
}) {
  return { identifier: r.identifier, title: r.title, status: r.status };
}
