import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { errorFields } from "../logger.js";
import {
  ERROR_STATUS,
  type ErrorCode,
  NotFoundError,
  ServiceError,
} from "../service/errors.js";
import type { AppEnv } from "./env.js";

export type ErrorBody = {
  error: { code: ErrorCode; message: string; details: Record<string, unknown> };
};

function respond(
  c: Context,
  code: ErrorCode,
  message: string,
  details: Record<string, unknown> = {},
) {
  const body: ErrorBody = { error: { code, message, details } };
  return c.json(body, ERROR_STATUS[code]);
}

/** Maps a ZodError to `{ fields: { "a.b": ["message", ...] } }`. */
export function zodDetails(err: ZodError): Record<string, unknown> {
  const fields: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.map(String).join(".") || "_";
    (fields[key] ??= []).push(issue.message);
  }
  return { fields };
}

/** The single place thrown errors become HTTP responses. */
export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof ServiceError) {
    return respond(c, err.code, err.message, err.details);
  }
  if (err instanceof ZodError) {
    return respond(c, "validation_error", "Validation failed", zodDetails(err));
  }
  if (err instanceof HTTPException && err.status < 500) {
    // Raised by Hono itself, e.g. a malformed or oversized body.
    const code: ErrorCode =
      err.status === 404 ? "not_found" : "validation_error";
    return respond(c, code, err.message || "Bad request");
  }
  c.get("logger").error("unhandled error", {
    requestId: c.get("requestId"),
    ...errorFields(err),
  });
  return respond(c, "internal", "Internal server error");
};

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) => {
  const err = new NotFoundError("Route not found");
  return respond(c, err.code, err.message);
};
