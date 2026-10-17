import {
  type Actor,
  type CreateTodoInput,
  createTodoInputSchema,
  type ListTodosInput,
  listTodosInputSchema,
  ServiceError,
  type Todo,
  type UpdateTodoInput,
  updateTodoInputSchema,
} from "@traccia/shared";
import { and, asc, desc, eq, isNull, ne, type SQL, sql } from "drizzle-orm";
import { todos } from "../db/schema.js";
import { newId } from "../ids.js";
import { decodeCursor, type Page, toPage } from "../rest/pagination.js";
import { nowIso } from "../time.js";
import {
  type DbHandle,
  parseInput,
  type ServiceContext,
  type Tx,
} from "./context.js";
import { POSITION_STEP } from "./issue-position.js";
import {
  deriveReferences,
  loadReferences,
  type TodoReference,
} from "./todo-references.js";
import { descKeysetAfter, pageLimit } from "./updated-at-page.js";

export type TodoRecord = typeof todos.$inferSelect;

/** A To-do as the service returns it; transports add `url` with `todoUrl`. */
export type TodoView = Omit<Todo, "url">;

/** Where a To-do opens in the dashboard; the API's `url` and the Reminder link. */
export const todoUrl = (baseUrl: string, id: string) =>
  `${baseUrl.replace(/\/+$/, "")}/personal?todo=${id}`;

export function toTodo(row: TodoRecord, references: TodoReference[]): TodoView {
  return {
    id: row.id,
    title: row.title,
    references,
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
    // §5: `deleted: true` only on a deleted To-do, on every read (not
    // `flagDeleted`, which adds `deleted: false` to live rows of some lists).
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

/**
 * The parent a new Sub-to-do hangs under: it must exist, be top-level (one
 * level deep), open and not deleted.
 */
function requireParent(db: DbHandle, parentId: string): void {
  const parent = db.select().from(todos).where(eq(todos.id, parentId)).get();
  const problem = !parent
    ? "does not exist"
    : parent.deletedAt !== null
      ? "is deleted"
      : parent.parentId !== null
        ? "is a Sub-to-do; Sub-to-dos go one level deep"
        : parent.state !== "open"
          ? "is closed"
          : null;
  if (problem === null) return;
  throw new ServiceError("validation_error", `parentId ${problem}`, {
    fields: { parentId: [`parentId ${problem}`] },
  });
}

/**
 * Closing a parent never leaves open Sub-to-dos behind silently: without
 * `closeSubTodos` it is a `conflict` that says how many are open; with it they
 * close the same way (done to done, dropped to dropped) at the same instant.
 * Sub-to-dos that are already closed or deleted are left alone.
 */
function closeOpenSubTodos(
  tx: Tx,
  parentId: string,
  state: "done" | "dropped",
  now: string,
  confirmed: boolean | undefined,
): void {
  const open = and(
    eq(todos.parentId, parentId),
    eq(todos.state, "open"),
    isNull(todos.deletedAt),
  );
  const count =
    tx.select({ n: sql<number>`count(*)` }).from(todos).where(open).get()?.n ??
    0;
  if (count === 0) return;
  if (!confirmed) {
    throw new ServiceError(
      "conflict",
      `To-do has ${count} open Sub-to-do${count === 1 ? "" : "s"}; send closeSubTodos: true to close them too`,
      { openSubTodos: count },
    );
  }
  tx.update(todos)
    .set({ state, closedAt: now, updatedAt: now })
    .where(open)
    .run();
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
  return descKeysetAfter(todos.closedAt, todos.id, c.c, c.i);
}

/** One To-do with its references. */
function view(db: DbHandle, row: TodoRecord): TodoView {
  return toTodo(row, loadReferences(db, [row]).get(row.id) ?? []);
}

/** The page's To-dos with their references, resolved in one query. */
function toTodos(db: DbHandle, rows: TodoRecord[]): TodoView[] {
  const references = loadReferences(db, rows);
  return rows.map((row) => toTodo(row, references.get(row.id) ?? []));
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
        const parentId = data.parentId ?? null;
        if (parentId !== null) requireParent(tx, parentId);
        const row = tx
          .insert(todos)
          .values({
            id: newId(),
            title: data.title,
            day,
            parentId,
            position: bottomOfBucket(tx, { day, parentId }),
            details: data.details || null,
            createdBy: actor,
            createdByToken: tokenName,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        deriveReferences(tx, row.id, row.title);
        return view(tx, row);
      });
    },

    /**
     * Partial update of a live To-do. A title change re-derives its
     * references, a new `day` moves it to the bottom of that bucket, and
     * `state` closes (`closed_at` is set) or reopens it (cleared). Closing a
     * To-do with open Sub-to-dos is a `conflict` carrying `openSubTodos`
     * unless `closeSubTodos` is true, which closes them the same way in the
     * same write. A stale `expectedUpdatedAt` is a `conflict` too.
     */
    update(id: string, input: UpdateTodoInput): TodoView {
      const { expectedUpdatedAt, closeSubTodos, ...patch } = parseInput(
        updateTodoInputSchema,
        input,
      );
      if (Object.values(patch).every((value) => value === undefined)) {
        throw new ServiceError("validation_error", "No fields to update");
      }
      return ctx.write((tx) => {
        const todo = findTodo(tx, id);
        if (todo.deletedAt !== null) {
          throw new ServiceError("not_found", `To-do "${id}" not found`);
        }
        if (expectedUpdatedAt && expectedUpdatedAt !== todo.updatedAt) {
          throw new ServiceError(
            "conflict",
            "To-do was modified since it was read",
            { currentUpdatedAt: todo.updatedAt },
          );
        }
        const now = nowIso();
        const set: Partial<typeof todos.$inferInsert> = {};

        if (patch.title !== undefined && patch.title !== todo.title) {
          set.title = patch.title;
        }
        if (patch.details !== undefined) {
          const details = patch.details || null;
          if (details !== todo.details) set.details = details;
        }
        if (patch.day !== undefined && patch.day !== todo.day) {
          set.day = patch.day;
          set.position = bottomOfBucket(tx, {
            day: patch.day,
            parentId: todo.parentId,
          });
        }
        if (patch.state !== undefined && patch.state !== todo.state) {
          set.state = patch.state;
          if (patch.state === "open") {
            set.closedAt = null;
          } else {
            set.closedAt = now;
            closeOpenSubTodos(tx, todo.id, patch.state, now, closeSubTodos);
          }
        }

        if (Object.keys(set).length === 0) return view(tx, todo);
        const row = tx
          .update(todos)
          .set({ ...set, updatedAt: now })
          .where(eq(todos.id, todo.id))
          .returning()
          .get();
        if (set.title !== undefined) deriveReferences(tx, row.id, row.title);
        return view(tx, row);
      });
    },

    /** One To-do, deleted ones included (flagged `deleted`). */
    get(id: string): TodoView {
      const row = findTodo(ctx.db, id);
      return view(ctx.db, row);
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
        return { ...page, items: toTodos(ctx.db, page.items) };
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
      return { ...page, items: toTodos(ctx.db, page.items) };
    },
  };
}

export type TodosService = ReturnType<typeof createTodosService>;
