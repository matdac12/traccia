import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ServiceError } from "@linear-matti/shared";
import type { z } from "zod";
import { decodeCursor, encodeCursor } from "../../rest/pagination.js";
import { createServices } from "../../service/index.js";
import { LocalDiskStorage } from "../../storage/index.js";
import { runTool, toolResult } from "../errors.js";
import type { Project, ProjectsService } from "../../service/projects.js";
import type { McpContext } from "../server.js";

/** Services for one MCP request, wired like the REST adapters. */
export function servicesFor(ctx: McpContext) {
  const { config, db } = ctx.container;
  return createServices({
    db,
    defaultIssueKey: config.defaultIssueKey,
    allowAgentPurge: config.allowAgentPurge,
    storage: new LocalDiskStorage(path.join(config.dataDir, "attachments")),
  });
}

/**
 * Registers a tool whose handler returns plain data; the wrapper turns it into
 * compact JSON text plus identical `structuredContent` and maps failures to
 * `isError` results.
 */
export function defineTool<S extends z.ZodRawShape>(
  server: McpServer,
  ctx: McpContext,
  name: string,
  description: string,
  inputSchema: S,
  handler: (
    args: z.infer<z.ZodObject<S>>,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>,
) {
  const run = (args: unknown) =>
    runTool(
      async () => toolResult(compact(await handler(args as never))),
      (err) =>
        ctx.container.logger.error("mcp tool failed", { tool: name, err }),
    );
  server.registerTool(name, { description, inputSchema }, run as never);
}

/** Drops `undefined`, `null` and empty-string fields ("omit empty fields"). */
export function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(
      ([, v]) => v !== undefined && v !== null && v !== "",
    ),
  ) as T;
}

/** `{ items, nextCursor }` over an already ordered list, using an offset cursor. */
export function paginate<T extends Record<string, unknown>>(
  all: T[],
  input: { limit?: number; cursor?: string },
): { items: T[]; nextCursor?: string } {
  const limit = input.limit ?? 50;
  let offset = 0;
  if (input.cursor) {
    const c = decodeCursor(input.cursor) as { o?: unknown };
    if (typeof c.o !== "number" || !Number.isInteger(c.o) || c.o < 0) {
      throw new ServiceError("validation_error", "Invalid cursor");
    }
    offset = c.o;
  }
  const items = all.slice(offset, offset + limit).map(compact);
  const next = offset + limit;
  return {
    items,
    ...(next < all.length ? { nextCursor: encodeCursor({ o: next }) } : {}),
  };
}

/** Clear message for an agent that tries to purge without permission. */
export function explainPurgeDenied(err: unknown): never {
  if (err instanceof ServiceError && err.code === "forbidden") {
    throw new ServiceError(
      "forbidden",
      "Agents cannot purge by default (purge is permanent and ALLOW_AGENT_PURGE is off). Nothing was changed. The item stays soft-deleted and can be restored; ask the owner to purge it from the dashboard.",
    );
  }
  throw err;
}

/**
 * Resolves a project reference; an unknown one fails with the list of known
 * projects so the agent can correct itself in one step.
 */
export function resolveProjectRef(
  projects: ProjectsService,
  ref: string,
  options: { includeDeleted?: boolean } = {},
): Project {
  try {
    return projects.get(ref, options);
  } catch (err) {
    if (err instanceof ServiceError && err.code === "not_found") {
      const known = projects
        .list()
        .map((p) => `${p.name} (${p.key})`)
        .join(", ");
      throw new ServiceError(
        "not_found",
        `${err.message}. Known projects: ${known || "none yet; create one with save_project"}.`,
      );
    }
    throw err;
  }
}
