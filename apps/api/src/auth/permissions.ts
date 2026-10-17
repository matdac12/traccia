import type { Actor } from "@traccia/shared";
import type { Config } from "../config.js";

/** Record types an `agent` may always purge (ADR 0015), whatever `ALLOW_AGENT_PURGE` says. */
const AGENT_PURGEABLE_TYPES: ReadonlySet<string> = new Set([
  "memory",
  "document",
]);

/** Record types purge is reserved for `you`, even when `ALLOW_AGENT_PURGE=true`. */
const YOU_ONLY_PURGE_TYPES: ReadonlySet<string> = new Set(["todo"]);

/**
 * Whether `actor` may permanently delete (purge) a record of `type`. Without a
 * `type` only the `ALLOW_AGENT_PURGE` switch applies, as for every type but
 * memories and documents. To-dos are `you` only, whatever the switch says.
 */
export function canPurge(
  actor: Actor,
  config: Pick<Config, "allowAgentPurge">,
  type?: string,
): boolean {
  if (actor === "you") return true;
  if (type !== undefined && YOU_ONLY_PURGE_TYPES.has(type)) return false;
  if (config.allowAgentPurge) return true;
  return type !== undefined && AGENT_PURGEABLE_TYPES.has(type);
}
