import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { ConfigError, loadConfigFromEnv } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { runMigrations } from "./db/migrate.js";

try {
  const config = loadConfigFromEnv();
  const { db } = openDatabase(config.dataDir);
  runMigrations(db);

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`api listening on http://localhost:${info.port}`);
  });
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
