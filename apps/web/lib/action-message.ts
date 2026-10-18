import type { ActionFailure } from "./action-result";

// Client-safe: `action-result.ts` imports the server-only API client, so client components can't import it.

/** The one line to show for a refused action: the first field error, else the message, as a sentence. */
export function firstError(failure: ActionFailure): string {
  const text = Object.values(failure.fieldErrors)[0] ?? failure.error;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
