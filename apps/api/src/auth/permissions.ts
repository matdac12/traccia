import type { Actor } from "@linear-matti/shared";
import type { Config } from "../config.js";

/** Whether `actor` may permanently delete (purge) records. */
export function canPurge(
  actor: Actor,
  config: Pick<Config, "allowAgentPurge">,
): boolean {
  return actor === "you" || config.allowAgentPurge;
}
