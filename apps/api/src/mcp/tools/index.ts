import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../server.js";
import { registerLabelTools } from "./labels.js";
import { registerMilestoneTools } from "./milestones.js";
import { registerProjectTools } from "./projects.js";
import { registerRestoreTool } from "./restore.js";

/** One import and one line per tool group; add new groups at the end. */
export function registerTools(server: McpServer, ctx: McpContext) {
  registerProjectTools(server, ctx);
  registerMilestoneTools(server, ctx);
  registerLabelTools(server, ctx);
  registerRestoreTool(server, ctx);
}
