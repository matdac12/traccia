import "server-only";
import { type Env, parseEnv } from "./env";

let cached: Env | undefined;

/** The validated server env. Throws a readable EnvError on the first bad read. */
export function serverEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
