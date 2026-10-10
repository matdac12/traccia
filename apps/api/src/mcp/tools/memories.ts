import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpPaginationShape } from "@traccia/shared";
import { z } from "zod";
import type { Memory } from "../../service/memories.js";
import type { McpContext } from "../server.js";
import { defineTool, explainPurgeDenied } from "./helpers.js";
import { compactObject, descriptionSnippet } from "./present.js";
import { mcpServices } from "./services.js";

const projectRef = z.string().min(1).describe("Project key, name or id.");

/** Full memory for `get_memory`/`save_memory`; list views use the snippet form. */
const presentMemory = (m: Memory) =>
  compactObject({
    id: m.id,
    projectId: m.projectId,
    title: m.title,
    body: m.body,
    tags: m.tags,
    createdBy: m.createdBy,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    deleted: m.deletedAt ? true : undefined,
  });

const PURGE_NOTE =
  "Soft-delete a memory (restorable via restore). purge=true permanently removes an already-deleted memory; agents may purge memories.";

export function registerMemoryTools(server: McpServer, ctx: McpContext) {
  const { memories, trash } = mcpServices(ctx);

  defineTool(
    server,
    ctx,
    "list_memories",
    "List a project's memories (titled markdown notes), most recently updated first. Bodies are snippets; use get_memory for the full text.",
    {
      project: projectRef,
      query: z.string().optional().describe("Match title or body."),
      tags: z.array(z.string()).optional().describe("All must be present."),
      includeDeleted: z.boolean().optional(),
      ...mcpPaginationShape,
    },
    ({ project, ...q }) => {
      const page = memories.list(project, q);
      return {
        items: page.items.map((m) => ({
          ...presentMemory(m),
          body: undefined,
          bodySnippet: descriptionSnippet(m.body),
        })),
        nextCursor: page.nextCursor,
      };
    },
  );

  defineTool(
    server,
    ctx,
    "get_memory",
    "Get a memory with its full markdown body.",
    { id: z.string().min(1).describe("Memory id.") },
    ({ id }) => presentMemory(memories.get(id)),
  );

  defineTool(
    server,
    ctx,
    "save_memory",
    "Create (no id; needs project + title) or update (with id; only given fields change) a memory: a short markdown note plus tags. Body max 64 KiB, up to 20 tags. expectedUpdatedAt fails on concurrent edits.",
    {
      id: z.string().optional(),
      project: projectRef.optional(),
      title: z.string().optional(),
      body: z
        .string()
        .optional()
        .describe("Markdown; replaces the whole text."),
      tags: z.array(z.string()).optional().describe("Replaces the whole set."),
      expectedUpdatedAt: z.string().optional(),
    },
    (args) => presentMemory(memories.save(ctx.actor, args)),
  );

  defineTool(
    server,
    ctx,
    "delete_memory",
    PURGE_NOTE,
    {
      id: z.string().min(1).describe("Memory id."),
      purge: z.boolean().optional(),
    },
    async ({ id, purge }) => {
      try {
        return {
          ...(await trash.delete(ctx.actor, "memory", id, { purge })),
        };
      } catch (err) {
        if (purge) explainPurgeDenied(err);
        throw err;
      }
    },
  );
}
