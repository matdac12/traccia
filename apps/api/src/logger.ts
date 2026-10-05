const LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export type LogLevel = (typeof LEVELS)[number];
export type LogLevelSetting = LogLevel | "silent";

export type LogFields = Record<string, unknown>;

export type Logger = {
  [K in LogLevel]: (msg: string, fields?: LogFields) => void;
};

export type LogSink = (line: string) => void;

const stdoutSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

/** Minimal JSON-lines logger. Entries below `level` are dropped. */
export function createLogger(
  level: string,
  sink: LogSink = stdoutSink,
): Logger {
  const threshold =
    level === "silent"
      ? Number.POSITIVE_INFINITY
      : LEVELS.indexOf(level as LogLevel);
  const logger = {} as Logger;
  for (const [i, name] of LEVELS.entries()) {
    logger[name] = (msg, fields) => {
      if (i < threshold) return;
      sink(
        JSON.stringify({
          level: name,
          time: new Date().toISOString(),
          msg,
          ...fields,
        }),
      );
    };
  }
  return logger;
}

/** Serialises an unknown thrown value for logging (server side only). */
export function errorFields(err: unknown): LogFields {
  if (err instanceof Error) {
    return { errName: err.name, errMessage: err.message, stack: err.stack };
  }
  return { errMessage: String(err) };
}
