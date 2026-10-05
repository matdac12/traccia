import { ServiceError } from "@traccia/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { decodeCursor, encodeCursor } from "../../rest/pagination.js";
import type { Project, ProjectsService } from "../../service/projects.js";
import { toolResult } from "../errors.js";
import type { McpContext } from "../server.js";
import { compactObject } from "./present.js";
import { runLogged } from "./run.js";

/** `compactObject`, but a list result keeps `items` even when empty. */
function withItems(data: Record<string, unknown>) {
  const out = compactObject(data);
  if ("items" in data) out.items = data.items;
  return out;
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
    runLogged(ctx, name, async () =>
      toolResult(withItems(await handler(args as never))),
    );
  server.registerTool(name, { description, inputSchema }, run as never);
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
  const items = all.slice(offset, offset + limit).map(compactObject) as T[];
  const next = offset + limit;
  return {
    items,
    ...(next < all.length ? { nextCursor: encodeCursor({ o: next }) } : {}),
  };
}

/** The one refusal text every MCP delete tool uses when an actor may not purge. */
export const PURGE_DENIED_MESSAGE =
  "Agents cannot purge by default (purge is permanent and ALLOW_AGENT_PURGE is off). Nothing was changed. Soft-delete instead (purge=false; restorable), then ask the owner ('you') to purge it from the dashboard.";

/** Clear message for an agent that tries to purge without permission. */
export function explainPurgeDenied(err: unknown): never {
  if (err instanceof ServiceError && err.code === "forbidden") {
    throw new ServiceError("forbidden", PURGE_DENIED_MESSAGE);
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
