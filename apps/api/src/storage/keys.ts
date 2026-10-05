import { newId } from "../ids.js";

/** Server-generated storage key: `<yyyy>/<mm>/<ulid>`. Never derived from user input. */
export function generateStorageKey(now: Date = new Date()): string {
  const yyyy = String(now.getUTCFullYear()).padStart(4, "0");
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}/${mm}/${newId()}`;
}
