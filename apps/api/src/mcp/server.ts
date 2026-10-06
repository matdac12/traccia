import type { Actor } from "@traccia/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pkg from "../../package.json" with { type: "json" };
import type { AppContainer } from "../rest/env.js";
import { runTool, toolResult } from "./errors.js";
import {
  type AttachmentToolDeps,
  registerAttachmentTools,
} from "./tools/attachments.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerIssueTools } from "./tools/issues.js";
import { registerLabelTools } from "./tools/labels.js";
import { registerMilestoneTools } from "./tools/milestones.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerRestoreTool } from "./tools/restore.js";

/** The caller, resolved by the auth middleware before the transport runs. */
export type McpContext = {
  container: AppContainer;
  actor: Actor;
  tokenName: string;
};

/**
 * Builds a server for one request (stateless). Tools are thin adapters over
 * the service layer and take the actor from `ctx`, never from tool input.
 *
 * `whoami` is kept deliberately: it is the cheapest way for an agent (or a
 * smoke test) to confirm its token works and which actor its writes get.
 */
export function createMcpServer(
  ctx: McpContext,
  deps: { attachments: AttachmentToolDeps },
): McpServer {
  const server = new McpServer({ name: "traccia", version: pkg.version });

  server.registerTool(
    "whoami",
    {
      description:
        "The actor ('agent' or 'you') and token name this connection writes as.",
    },
    () =>
      runTool(
        () => toolResult({ actor: ctx.actor, tokenName: ctx.tokenName }),
        (err) =>
          ctx.container.logger.error("mcp tool failed", {
            tool: "whoami",
            err,
          }),
      ),
  );

  registerIssueTools(server, ctx);
  registerCommentTools(server, ctx);
  registerAttachmentTools(server, ctx, deps.attachments);
  registerProjectTools(server, ctx);
  registerMilestoneTools(server, ctx);
  registerLabelTools(server, ctx);
  registerRestoreTool(server, ctx);
  dropDefaultExecution(server);

  return server;
}

/**
 * The SDK stamps `execution: { taskSupport: "forbidden" }` on every tool, which
 * is what an absent `execution` already means; it costs ~40 bytes per tool in
 * every `tools/list` (TRC-123). The size test in mcp-tool-list.test.ts fails if
 * an SDK upgrade stops this from taking effect.
 */
function dropDefaultExecution(server: McpServer) {
  const tools = (
    server as unknown as {
      _registeredTools?: Record<string, { execution?: unknown }>;
    }
  )._registeredTools;
  for (const tool of Object.values(tools ?? {})) delete tool.execution;
}
