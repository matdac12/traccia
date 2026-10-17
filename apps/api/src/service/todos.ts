import {
  type Actor,
  type CreateTodoInput,
  createTodoInputSchema,
  type ListTodosInput,
  listTodosInputSchema,
  ServiceError,
  type Todo,
} from "@traccia/shared";
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { todos } from "../db/schema.js";
import { newId } from "../ids.js";
import { decodeCursor, type Page, toPage } from "../rest/pagination.js";
import { nowIso } from "../time.js";
import { type DbHandle, parseInput, type ServiceContext } from "./context.js";
import { POSITION_STEP } from "./issue-position.js";
import { pageLimit } from "./updated-at-page.js";

export type TodoRecord = typeof todos.$inferSelect;

/** A To-do as the service returns it; transports add `url` with `todoUrl`. */
export type TodoView = Omit<Todo, "url">;

/** Where a To-do opens in the dashboard; the API's `url` and the Reminder link. */
export const todoUrl = (baseUrl: string, id: string) =>
  `${baseUrl.replace(/\/+$/, "")}/personal?todo=${id}`;

export function toTodo(row: TodoRecord): TodoView {
  return {
    id: row.id,
    title: row.title,
    // Project references are derived from the title from step 02 on.
    references: [],
    day: row.day,
    reminder:
      row.reminderTime !== null && row.reminderStatus !== null
        ? {
            time: row.reminderTime,
            status: row.reminderStatus,
            failure: row.reminderFailure,
            sentAt: row.reminderSentAt,
          }
        : null,
    state: row.state,
    closedAt: row.closedAt,
    parentId: row.parentId,
    position: row.position,
    details: row.details,
    source: row.createdByToken,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.deletedAt !== null ? { deleted: true as const } : {}),
  };
}

function findTodo(db: DbHandle, id: string): TodoRecord {
  const row = db.select().from(todos).where(eq(todos.id, id)).get();
  if (!row) throw new ServiceError("not_found", `To-do "${id}" not found`);
  return row;
}

/**
 * The Position just below the last live To-do of a bucket: one Planned day
 * (or Anytime) under one parent (or top level).
 */
function bottomOfBucket(
  db: DbHandle,
  bucket: { day: string | null; parentId: string | null },
): number {
  const row = db
    .select({ max: sql<number | null>`max(${todos.position})` })
    .from(todos)
    .where(
      and(
        bucket.day === null ? isNull(todos.day) : eq(todos.day, bucket.day),
        bucket.parentId === null
          ? isNull(todos.parentId)
          : eq(todos.parentId, bucket.parentId),
        isNull(todos.deletedAt),
      ),
    )
    .get();
  return (row?.max ?? 0) + POSITION_STEP;
}

const invalidCursor = () =>
  new ServiceError("validation_error", "Invalid cursor", {
    fields: { cursor: ["Invalid cursor"] },
  });

function decode(cursor: string): Record<string, unknown> {
  try {
    return decodeCursor(cursor) as Record<string, unknown>;
  } catch {
    throw invalidCursor();
  }
}

/** Open list: the offset the cursor was made at. */
function openOffset(cursor: string): number {
  const { o } = decode(cursor);
  if (typeof o !== "number" || !Number.isInteger(o) || o < 0) {
    throw invalidCursor();
  }
  return o;
}

/** Logbook keyset: continue after the `(closed_at, id)` the cursor was made from. */
function afterClosedCursor(cursor: string): SQL | undefined {
  const c = decode(cursor);
  if (typeof c.c !== "string" || typeof c.i !== "string") throw invalidCursor();
  return or(
    lt(todos.closedAt, c.c),
    and(eq(todos.closedAt, c.c), lt(todos.id, c.i)),
  );
}

export function createTodosService(ctx: ServiceContext) {
  return {
    /**
     * Creates an open To-do at the bottom of its bucket. `tokenName` is the
     * creating Token's name, kept as the To-do's `source`.
     */
    create(actor: Actor, tokenName: string, input: CreateTodoInput): TodoView {
      const data = parseInput(createTodoInputSchema, input);
      return ctx.write((tx) => {
        const now = nowIso();
        const day = data.day ?? null;
        const row = tx
          .insert(todos)
          .values({
            id: newId(),
            title: data.title,
            day,
            position: bottomOfBucket(tx, { day, parentId: null }),
            details: data.details || null,
            createdBy: actor,
            createdByToken: tokenName,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        return toTodo(row);
      });
    },

    /** One To-do, deleted ones included (flagged `deleted`). */
    get(id: string): TodoView {
      return toTodo(findTodo(ctx.db, id));
    },

    /**
     * `open`: every open To-do as one flat list, Sub-to-dos included, by
     * Planned day (Anytime last), then Position, then id; offset-paged.
     * `closed`: the Logbook, done and dropped, newest `closed_at` first,
     * keyset-paged on `(closed_at, id)`. Deleted To-dos only with
     * `includeDeleted`.
     */
    list(input: ListTodosInput): Page<TodoView> {
      const q = parseInput(listTodosInputSchema, input);
      const limit = pageLimit(q.limit);
      const live = q.includeDeleted ? undefined : isNull(todos.deletedAt);

      if (q.state === "open") {
        const offset = q.cursor === undefined ? 0 : openOffset(q.cursor);
        const rows = ctx.db
          .select()
          .from(todos)
          .where(and(eq(todos.state, "open"), live))
          .orderBy(
            sql`${todos.day} IS NULL`,
            asc(todos.day),
            asc(todos.position),
            asc(todos.id),
          )
          .limit(limit + 1)
          .offset(offset)
          .all();
        const page = toPage(rows, limit, () => ({ o: offset + limit }));
        return { ...page, items: page.items.map(toTodo) };
      }

      const rows = ctx.db
        .select()
        .from(todos)
        .where(
          and(
            ne(todos.state, "open"),
            live,
            q.cursor === undefined ? undefined : afterClosedCursor(q.cursor),
          ),
        )
        .orderBy(desc(todos.closedAt), desc(todos.id))
        .limit(limit + 1)
        .all();
      const page = toPage(rows, limit, (last) => ({
        c: last.closedAt,
        i: last.id,
      }));
      return { ...page, items: page.items.map(toTodo) };
    },
  };
}

export type TodosService = ReturnType<typeof createTodosService>;
