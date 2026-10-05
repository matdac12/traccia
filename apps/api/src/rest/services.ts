import path from "node:path";
import { createServices, type Services } from "../service/index.js";
import { LocalDiskStorage } from "../storage/index.js";
import type { AppContainer } from "./env.js";

const cache = new WeakMap<AppContainer, Services>();

/**
 * One service container per app container, shared by the issue-side route
 * files. Storage matches the attachment routes' default so purge can remove
 * attachment files.
 */
export function servicesFor(container: AppContainer): Services {
  let services = cache.get(container);
  if (!services) {
    const { config, db } = container;
    services = createServices({
      db,
      defaultIssueKey: config.defaultIssueKey,
      allowAgentPurge: config.allowAgentPurge,
      storage: new LocalDiskStorage(path.join(config.dataDir, "attachments")),
    });
    cache.set(container, services);
  }
  return services;
}
