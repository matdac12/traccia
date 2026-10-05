import { ServiceError as SharedServiceError } from "@linear-matti/shared";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";
import { ServiceError } from "../service/errors.js";

/** A tool result flagged as an error, with a message the agent can act on. */
export function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/**
 * Runs a tool body and turns expected failures into `isError` results.
 * Service errors carry actionable messages already; anything else is logged
 * by the caller's logger and reported generically so internals never leak.
 */
export async function runTool(
  fn: () => CallToolResult | Promise<CallToolResult>,
  onUnexpected?: (err: unknown) => void,
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    // Two classes share the name: the shared one is thrown by most services.
    if (err instanceof ServiceError || err instanceof SharedServiceError)
      return toolError(err.message);
    if (err instanceof ZodError) {
      return toolError(
        err.issues
          .map(
            (i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message,
          )
          .join("; "),
      );
    }
    onUnexpected?.(err);
    return toolError("Internal error. Retry; if it persists, report it.");
  }
}

/** Compact JSON as text content plus `structuredContent` (spec section 11). */
export function toolResult(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}
