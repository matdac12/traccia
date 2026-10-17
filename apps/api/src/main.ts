import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ConfigError, loadConfigFromEnv } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { runMigrations } from "./db/migrate.js";
import { createLogger, errorFields } from "./logger.js";
import { createReminderScheduler } from "./reminders/scheduler.js";
import { createTelegramClient } from "./reminders/telegram.js";

try {
  const config = loadConfigFromEnv();
  const logger = createLogger(config.logLevel);
  const { sqlite, db } = openDatabase(config.dataDir);
  runMigrations(db);

  const reminders = createReminderScheduler({
    db,
    ownerTimezone: config.ownerTimezone,
    baseUrl: config.baseUrl,
    telegram: config.telegram && createTelegramClient(config.telegram),
    logger,
  });
  const app = createApp({ config, db, logger, reminders });
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info("api listening", { port: info.port });
  });
  reminders.start();
  if (!config.telegram) {
    logger.info("reminders are off: TELEGRAM_BOT_TOKEN is not set");
  }

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutting down", { signal });
    // The scheduler stops first: a check in progress may still write.
    const stopped = reminders.stop().catch((err: unknown) => {
      logger.error("reminder scheduler stop failed", errorFields(err));
    });
    server.close(() => {
      void stopped.then(() => {
        sqlite.close();
        process.exit(0);
      });
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
