import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { runTool } from "../errors.js";
import type { McpContext } from "../server.js";

/** Runs a tool body, logging unexpected failures under the tool's name. */
export function runLogged(
  ctx: McpContext,
  tool: string,
  fn: () => CallToolResult | Promise<CallToolResult>,
): Promise<CallToolResult> {
  return runTool(fn, (err) =>
    ctx.container.logger.error("mcp tool failed", { tool, err }),
  );
}
