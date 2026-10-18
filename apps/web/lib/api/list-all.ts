import "server-only";
import type { z } from "zod";
import { api } from "./client";
import { pageOf } from "./schemas";

/** Every item of a paginated list, following `nextCursor` 250 at a time (for small lists). */
export async function listAll<T extends z.ZodType>(path: string, item: T, query: Record<string, string | undefined> = {}) {
  const items: z.output<T>[] = [];
  let cursor: string | undefined;
  do {
    const page = await api().request(path, { schema: pageOf(item), query: { ...query, limit: 250, cursor } });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}
