import type { Actor } from "@traccia/shared";
import type { Config } from "../config.js";

/** Whether `actor` may permanently delete (purge) records. */
export function canPurge(
  actor: Actor,
  config: Pick<Config, "allowAgentPurge">,
): boolean {
  return actor === "you" || config.allowAgentPurge;
}
