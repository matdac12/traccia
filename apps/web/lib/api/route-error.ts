import "server-only";
import { ApiError } from "./client";

/** A route handler's failure as the API's own error shape (`{ error: { code, message, details } }`). */
export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status === 0 ? 502 : err.status });
  }
  throw err;
}
