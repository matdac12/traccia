import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { createLogger } from "../../src/logger.js";
import { createTestDb } from "./test-db.js";

/** An app over a fresh in-memory DB; `logs` collects emitted log lines. */
export function createTestApp(
  env: Record<string, string> = {},
  mcpDeps?: Parameters<typeof createApp>[1],
  oauthHardening?: Parameters<typeof createApp>[2],
) {
  const config = loadConfig({ BASE_URL: "http://localhost:8787", ...env });
  const { db, sqlite } = createTestDb();
  const logs: string[] = [];
  const logger = createLogger(config.logLevel, (line) => logs.push(line));
  const app = createApp({ config, db, logger }, mcpDeps, oauthHardening);
  return { app, logs, sqlite, db, config };
}
