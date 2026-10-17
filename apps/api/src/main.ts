import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ConfigError, loadConfigFromEnv } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { runMigrations } from "./db/migrate.js";
import { createLogger } from "./logger.js";

try {
  const config = loadConfigFromEnv();
  const logger = createLogger(config.logLevel);
  const { sqlite, db } = openDatabase(config.dataDir);
  runMigrations(db);

  const app = createApp({ config, db, logger });
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info("api listening", { port: info.port });
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutting down", { signal });
    server.close(() => {
      sqlite.close();
      process.exit(0);
    });
    // Don't wait forever on keep-alive connections.
    setTimeout(() => {
      sqlite.close();
      process.exit(1);
    }, 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
