import { ValidationError } from "../service/errors.js";
import { type Page, type PaginationQuery, toPage } from "./pagination.js";

/**
 * Pages an already-ordered list (cursor = offset into it). For small
 * collections the service returns whole; large ones use keyset cursors.
 */
export function pageOfArray<T>(rows: T[], q: PaginationQuery): Page<T> {
  const cursor = q.cursor as { o?: unknown } | undefined;
  let offset = 0;
  if (cursor !== undefined) {
    if (
      typeof cursor.o !== "number" ||
      !Number.isInteger(cursor.o) ||
      cursor.o < 0
    ) {
      throw new ValidationError("Invalid cursor", {
        fields: { cursor: ["Invalid cursor"] },
      });
    }
    offset = cursor.o;
  }
  const window = rows.slice(offset, offset + q.limit + 1);
  return toPage(window, q.limit, () => ({ o: offset + q.limit }));
}
