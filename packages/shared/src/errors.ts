export const SERVICE_ERROR_CODES = [
  "not_found",
  "validation_error",
  "conflict",
  "forbidden",
] as const;
export type ServiceErrorCode = (typeof SERVICE_ERROR_CODES)[number];

/**
 * The one error type services throw for expected failures. Transports map it:
 * REST via `SERVICE_ERROR_HTTP_STATUS`, MCP to a tool error carrying `code`
 * and `message`. Anything else thrown by a service is a bug (HTTP 500).
 *
 * `details` is optional structured context (e.g. the candidate ids of an
 * ambiguous reference or the Zod issues of a validation failure).
 */
export class ServiceError extends Error {
  override name = "ServiceError";

  constructor(
    readonly code: ServiceErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const SERVICE_ERROR_HTTP_STATUS: Record<ServiceErrorCode, number> = {
  not_found: 404,
  validation_error: 400,
  conflict: 409,
  forbidden: 403,
};
