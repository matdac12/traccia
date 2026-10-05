import type { Actor } from "@linear-matti/shared";

/** Whether `actor` may permanently delete (purge) records. */
export function canPurge(
  actor: Actor,
  config: { allowAgentPurge: boolean },
): boolean {
  return actor === "you" || config.allowAgentPurge;
}
