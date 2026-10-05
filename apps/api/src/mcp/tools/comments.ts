import { ServiceError } from "@linear-matti/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { canPurge } from "../../auth/permissions.js";
import { decodeCursor, encodeCursor } from "../../rest/pagination.js";
import { resolveIssue } from "../../service/issues.js";
import { toolError, toolResult } from "../errors.js";
import type { McpContext } from "../server.js";
import { attachmentsByComment, presentComment } from "./present.js";
import { runLogged } from "./run.js";
import { mcpServices } from "./services.js";

const DEFAULT_LIMIT = 50;

export function registerCommentTools(server: McpServer, ctx: McpContext) {
  const { db } = ctx.container;
  const services = mcpServices(ctx);

  server.registerTool(
    "list_comments",
    {
      description:
        "List an issue's comments oldest first, replies directly after their parent (parentId set). Deleted comments are hidden unless includeDeleted.",
      inputSchema: {
        issueId: z.string().describe("Issue identifier like ABC-123."),
        includeDeleted: z.boolean().optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(250)
          .optional()
          .describe("Default 50."),
        cursor: z.string().optional().describe("From a previous nextCursor."),
      },
    },
    ({ issueId, includeDeleted, limit, cursor }) =>
      runLogged(ctx, "list_comments", () => {
        const threads = services.comments.list(issueId, { includeDeleted });
        const flat = threads.flatMap(({ replies, ...top }) => [
          top,
          ...replies,
        ]);
        let offset = 0;
        if (cursor) {
          const payload = decodeCursor(cursor) as { offset?: unknown };
          if (
            typeof payload.offset !== "number" ||
            !Number.isInteger(payload.offset) ||
            payload.offset < 0
          ) {
            throw new ServiceError("validation_error", "Invalid cursor");
          }
          offset = payload.offset;
        }
        const size = limit ?? DEFAULT_LIMIT;
        const issue = resolveIssue(db, issueId);
        const files = attachmentsByComment(db, issue.id);
        const items = flat
          .slice(offset, offset + size)
          .map((c) => presentComment(c, files.get(c.id) ?? []));
        return toolResult({
          items,
          nextCursor:
            flat.length > offset + size
              ? encodeCursor({ offset: offset + size })
              : null,
        });
      }),
  );

  server.registerTool(
    "save_comment",
    {
      description:
        "Create (no id; needs issueId) or edit (with id) a markdown comment. You can only edit comments written by your own actor. parentId replies to a top-level comment (one level of threading).",
      inputSchema: {
        id: z.string().optional().describe("Comment id. Omit to create."),
        issueId: z.string().optional().describe("Required on create."),
        body: z.string().min(1).describe("Markdown."),
        parentId: z
          .string()
          .optional()
          .describe("Reply to a top-level comment (create only)."),
      },
    },
    ({ id, issueId, body, parentId }) =>
      runLogged(ctx, "save_comment", () => {
        if (id) {
          if (issueId || parentId) {
            return toolError(
              "issueId and parentId only apply when creating a comment; omit them when editing (with id).",
            );
          }
          const c = services.comments.update(ctx.actor, id, { body });
          return toolResult(
            presentComment(
              c,
              attachmentsByComment(db, c.issueId).get(c.id) ?? [],
            ),
          );
        }
        if (!issueId) {
          return toolError(
            "Creating a comment requires 'issueId'. To edit a comment pass its 'id'.",
          );
        }
        const c = services.comments.create(ctx.actor, issueId, {
          body,
          parentId,
        });
        return toolResult(presentComment(c, []));
      }),
  );

  server.registerTool(
    "delete_comment",
    {
      description:
        "Soft-delete a comment and its replies (restorable via restore). purge=true permanently removes an ALREADY deleted comment; only allowed for actor 'you' (or agents when ALLOW_AGENT_PURGE is on).",
      inputSchema: {
        id: z.string().describe("Comment id."),
        purge: z.boolean().optional().describe("Default false."),
      },
    },
    ({ id, purge }) =>
      runLogged(ctx, "delete_comment", async () => {
        if (purge && !canPurge(ctx.actor, ctx.container.config)) {
          return toolError(
            `Actor '${ctx.actor}' may not purge. Soft-delete instead (purge=false; restorable), or ask 'you' to purge.`,
          );
        }
        const result = await services.trash.delete(ctx.actor, "comment", id, {
          purge: purge ?? false,
        });
        return toolResult({ ...result });
      }),
  );
}
