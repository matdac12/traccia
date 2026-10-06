import type { Actor } from "@traccia/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/connection.js";
import type { LogFields, Logger } from "../logger.js";

/** Everything the app needs from outside; tests build one against a temp DB. */
export type AppContainer = {
  config: Config;
  db: Db;
  logger: Logger;
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
  };
};
