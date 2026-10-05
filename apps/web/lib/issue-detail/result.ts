import type { IssueDetail } from "@/lib/api/schemas";
import { ApiError } from "@/lib/api/client";

/**
 * What every issue-detail server action returns. Actions never throw to the client (Next hides
 * thrown messages in production); failures carry the API's standard error code and message.
 */
export type Failure = {
  ok: false;
  code: string;
  message: string;
  /** For `conflict`: the issue as it is now, so the caller can offer to re-apply a change on top of it. */
  current?: IssueDetail;
};
export type ActionResult<T extends object = object> = ({ ok: true } & T) | Failure;

export function toFailure(err: unknown): Failure {
  if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message };
  return { ok: false, code: "unknown", message: err instanceof Error ? err.message : "Something went wrong" };
}
