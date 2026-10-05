import { restoreToolShape } from "@linear-matti/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../server.js";
import { defineTool } from "./helpers.js";
import { compactObject } from "./present.js";
import { mcpServices } from "./services.js";

export function registerRestoreTool(server: McpServer, ctx: McpContext) {
  const { trash } = mcpServices(ctx);
  defineTool(
    server,
    ctx,
    "restore",
    "Undo a soft delete: restores the item and everything deleted with it in the same action. Restoring a milestone does not re-link its issues.",
    restoreToolShape,
    (args) => ({ ...trash.restore(ctx.actor, args.type, args.id) }),
  );
}
