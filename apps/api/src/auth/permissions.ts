import type { Actor } from "@traccia/shared";
import type { Config } from "../config.js";

/** Record types an `agent` may always purge (ADR 0015), whatever `ALLOW_AGENT_PURGE` says. */
const AGENT_PURGEABLE_TYPES: ReadonlySet<string> = new Set([
  "memory",
  "document",
]);

/**
 * Whether `actor` may permanently delete (purge) a record of `type`. Without a
 * `type` only the `ALLOW_AGENT_PURGE` switch applies, as for every type but
 * memories and documents.
 */
export function canPurge(
  actor: Actor,
  config: Pick<Config, "allowAgentPurge">,
  type?: string,
): boolean {
  if (actor === "you" || config.allowAgentPurge) return true;
  return type !== undefined && AGENT_PURGEABLE_TYPES.has(type);
}
