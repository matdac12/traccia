export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_error"
  | "conflict"
  | "rate_limited"
  | "internal";

/** HTTP status for each public error code. */
export const ERROR_STATUS = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_error: 400,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
} as const satisfies Record<ErrorCode, number>;

/** Base class for errors the service layer throws on purpose. */
export class ServiceError extends Error {
  override name = "ServiceError";

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export class UnauthorizedError extends ServiceError {
  constructor(message = "Missing or invalid credentials", details = {}) {
    super("unauthorized", message, details);
  }
}

export class ForbiddenError extends ServiceError {
  constructor(message = "Not allowed", details = {}) {
    super("forbidden", message, details);
  }
}

export class NotFoundError extends ServiceError {
  constructor(message = "Not found", details = {}) {
    super("not_found", message, details);
  }
}

export class ValidationError extends ServiceError {
  constructor(message = "Validation failed", details = {}) {
    super("validation_error", message, details);
  }
}

export class ConflictError extends ServiceError {
  constructor(message = "Conflict", details = {}) {
    super("conflict", message, details);
  }
}

export class RateLimitedError extends ServiceError {
  constructor(message = "Too many requests", details = {}) {
    super("rate_limited", message, details);
  }
}
