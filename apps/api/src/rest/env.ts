import type { Actor } from "@traccia/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/connection.js";
import type { LogFields, Logger } from "../logger.js";
import type { ReminderScheduler } from "../reminders/scheduler.js";
import type { TokenScope } from "../service/tokens.js";

/** Everything the app needs from outside; tests build one against a temp DB. */
export type AppContainer = {
  config: Config;
  db: Db;
  logger: Logger;
  /**
   * The Reminder scheduler (`main.ts` starts it). Absent in tests that don't
   * need it: To-do writes then reschedule nothing, `/healthz` has no
   * `reminders`, and delivery is reported from the config alone.
   */
  reminders?: ReminderScheduler;
};

export type AppEnv = {
  Variables: {
    requestId: string;
    clientIp: string | undefined;
    logger: Logger;
    /** Extra fields a route adds to its request log line. */
    logFields?: LogFields;
    container: AppContainer;
    /** Set by the auth middleware on /v1 routes. */
    actor: Actor;
    tokenId: string;
    tokenName: string;
    scope: TokenScope;
  };
};
