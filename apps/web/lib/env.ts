import { z } from "zod";
import { accessConfigFromEnv, parseLogins } from "./access";

/**
 * Server environment, validated once at startup (`instrumentation.ts`) and on first use.
 * None of these may carry a `NEXT_PUBLIC_` prefix: the token must stay on the server.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  TRACKER_API_URL: z.url("must be a URL like http://api:8787"),
  TRACKER_API_TOKEN: z.string().min(1, "must be a `you` token from `tracker token create`"),
  DASHBOARD_ALLOWED_LOGINS: z.string().default(""),
  DASHBOARD_DEV_LOGIN: z.string().optional(),
});

export type Env = {
  apiUrl: string;
  apiToken: string;
  access: ReturnType<typeof accessConfigFromEnv>;
};

export class EnvError extends Error {
  override name = "EnvError";
}

/** Validates an env-like record. Throws EnvError naming each bad variable. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  // Empty strings count as unset (compose passes `${VAR:-}` as "").
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ""),
  );
  const result = envSchema.safeParse(cleaned);
  const problems = result.success
    ? []
    : result.error.issues.map((i) => `  - ${String(i.path[0])}: ${i.message}`);
  // Cross-field rules run even when other variables are bad, so one run lists every problem.
  const nodeEnv = cleaned.NODE_ENV ?? "development";
  const devLogin = cleaned.DASHBOARD_DEV_LOGIN?.trim();
  if (devLogin && nodeEnv === "production") {
    problems.push("  - DASHBOARD_DEV_LOGIN: is a local-development bypass and is refused when NODE_ENV=production");
  }
  if (!devLogin && parseLogins(cleaned.DASHBOARD_ALLOWED_LOGINS).length === 0) {
    problems.push("  - DASHBOARD_ALLOWED_LOGINS: must list at least one Tailscale login (comma-separated), or nobody can get in");
  }
  if (!result.success || problems.length) {
    throw new EnvError(`Invalid dashboard configuration:\n${problems.join("\n")}`);
  }
  const e = result.data;
  return {
    apiUrl: e.TRACKER_API_URL.replace(/\/+$/, ""),
    apiToken: e.TRACKER_API_TOKEN,
    access: accessConfigFromEnv({ ...cleaned, NODE_ENV: e.NODE_ENV }),
  };
}
