import path from "node:path";
import { createServices } from "../../service/index.js";
import { LocalDiskStorage } from "../../storage/index.js";
import type { McpContext } from "../server.js";

/** The shared service container, wired the same way as the REST routes. */
export function mcpServices({ container }: McpContext) {
  const { config, db } = container;
  return createServices({
    db,
    defaultIssueKey: config.defaultIssueKey,
    allowAgentPurge: config.allowAgentPurge,
    storage: new LocalDiskStorage(path.join(config.dataDir, "attachments")),
  });
}
