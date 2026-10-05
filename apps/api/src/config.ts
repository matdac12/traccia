import { z } from "zod";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATA_DIR: z.string().min(1).default("/data"),
  BASE_URL: z.url(),
  MAX_ATTACHMENT_BYTES: z.coerce.number().int().positive().default(10485760),
  MAX_MCP_UPLOAD_BYTES: z.coerce.number().int().positive().default(5242880),
  DEFAULT_ISSUE_KEY: z.string().min(1).default("MAT"),
  ALLOW_AGENT_PURGE: bool.default(false),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_YOU_PER_MIN: z.coerce.number().int().positive().default(1200),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  TRUST_PROXY: bool.default(true),
  OAUTH_ADMIN_SECRET: z.string().min(16).optional(),
  SOURCE_URL_EXTRA_PORTS: z
    .string()
    .default("")
    .transform((v, ctx) => {
      const ports: number[] = [];
      for (const part of v.split(",").map((p) => p.trim())) {
        if (part === "") continue;
        const n = Number(part);
        if (!/^\d+$/.test(part) || n < 1 || n > 65535) {
          ctx.addIssue({
            code: "custom",
            message: `"${part}" is not a port (expected a comma-separated list of 1-65535)`,
          });
          return z.NEVER;
        }
        ports.push(n);
      }
      return ports;
    }),
});

/** Every environment variable the api reads; the README config table is checked against this. */
export const CONFIG_ENV_VARS = Object.keys(envSchema.shape);

export type Config = {
  port: number;
  dataDir: string;
  baseUrl: string;
  maxAttachmentBytes: number;
  maxMcpUploadBytes: number;
  defaultIssueKey: string;
  allowAgentPurge: boolean;
  rateLimitPerMin: number;
  rateLimitYouPerMin: number;
  logLevel: string;
  trustProxy: boolean;
  sourceUrlExtraPorts: number[];
  /** Consent-page secret; the OAuth server is disabled while unset. */
  oauthAdminSecret: string | undefined;
};

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Validates an env-like record. Throws ConfigError naming each bad variable. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  // Treat empty strings as unset so `PORT=` falls back to the default.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ""),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map(
      (i) => `${String(i.path[0])}: ${i.message}`,
    );
    throw new ConfigError(
      `Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
  }
  const e = result.data;
  return {
    port: e.PORT,
    dataDir: e.DATA_DIR,
    baseUrl: e.BASE_URL,
    maxAttachmentBytes: e.MAX_ATTACHMENT_BYTES,
    maxMcpUploadBytes: e.MAX_MCP_UPLOAD_BYTES,
    defaultIssueKey: e.DEFAULT_ISSUE_KEY,
    allowAgentPurge: e.ALLOW_AGENT_PURGE,
    rateLimitPerMin: e.RATE_LIMIT_PER_MIN,
    rateLimitYouPerMin: e.RATE_LIMIT_YOU_PER_MIN,
    logLevel: e.LOG_LEVEL,
    trustProxy: e.TRUST_PROXY,
    sourceUrlExtraPorts: e.SOURCE_URL_EXTRA_PORTS,
    oauthAdminSecret: e.OAUTH_ADMIN_SECRET,
  };
}

/** The only place that reads process.env. */
export function loadConfigFromEnv(): Config {
  return loadConfig(process.env);
}
