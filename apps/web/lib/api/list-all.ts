import "server-only";
import type { z } from "zod";
import { api, type WireInput } from "./client";
import { pageOf } from "./schemas";

type ListAllOptions = {
  pageSize?: number;
  /** Bounds the walk over the pages. */
  maxPages?: number;
  /** Each page is read conditionally (`RequestOptions.conditional`). */
  conditional?: boolean;
};

/**
 * Every item of a paginated list, following `nextCursor` (for small lists). `querySchema` is the route's
 * shared query schema (page fields included); `query` is typed against it.
 */
export async function listAll<T extends z.ZodType, QS extends z.ZodType>(
  path: string,
  item: T,
  querySchema: QS,
  query: Omit<WireInput<QS>, "limit" | "cursor">,
  { pageSize = 250, maxPages = Number.POSITIVE_INFINITY, conditional }: ListAllOptions = {},
) {
  const items: z.output<T>[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    // `never`: RequestOptions["query"] is conditional on the generic QS, which TS cannot resolve here. The caller's `query` is typed.
    const page = await api().request(path, { schema: pageOf(item), querySchema, query: { ...query, limit: pageSize, cursor } as never, conditional });
    items.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}
