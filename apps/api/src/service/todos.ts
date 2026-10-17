import {
  type Actor,
  type CreateTodoInput,
  createTodoInputSchema,
  type ListTodosInput,
  listTodosInputSchema,
  type MoveTodoPositionInput,
  moveTodoPositionInputSchema,
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
import { POSITION_STEP, slotPosition } from "./issue-position.js";
import {
  newSchedule,
  skippedOnReopen,
  updatedSchedule,
} from "./todo-reminder.js";
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
    .where(inBucket(bucket))
    .get();
  return (row?.max ?? 0) + POSITION_STEP;
}

/** The live To-dos of one bucket. */
function inBucket(bucket: { day: string | null; parentId: string | null }) {
  return and(
    bucket.day === null ? isNull(todos.day) : eq(todos.day, bucket.day),
    bucket.parentId === null
      ? isNull(todos.parentId)
      : eq(todos.parentId, bucket.parentId),
    isNull(todos.deletedAt),
  );
}

/**
 * Renumbers a bucket (already in order) as STEP, 2*STEP, ... Only changed rows
 * are written, and `updated_at` is left alone: order is not content, and
 * bumping it would spuriously invalidate other callers' `expectedUpdatedAt`.
 */
function rebalance(tx: Tx, bucket: TodoRecord[]): void {
  bucket.forEach((row, i) => {
    const position = (i + 1) * POSITION_STEP;
    if (row.position === position) return;
    tx.update(todos).set({ position }).where(eq(todos.id, row.id)).run();
    row.position = position;
  });
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

/** A live To-do, else `not_found` (a deleted one cannot be edited or moved). */
function requireLiveTodo(db: DbHandle, id: string): TodoRecord {
  const todo = findTodo(db, id);
  if (todo.deletedAt !== null) {
    throw new ServiceError("not_found", `To-do "${id}" not found`);
  }
  return todo;
}

/** A stale `expectedUpdatedAt` is a `conflict` that says the current one. */
function requireFresh(todo: TodoRecord, expectedUpdatedAt?: string): void {
  if (expectedUpdatedAt && expectedUpdatedAt !== todo.updatedAt) {
    throw new ServiceError("conflict", "To-do was modified since it was read", {
      currentUpdatedAt: todo.updatedAt,
    });
  }
}

type TodoChanges = Partial<typeof todos.$inferInsert>;

/** Title and Details: the content, which never touches the Reminder. */
function contentChanges(
  todo: TodoRecord,
  patch: Pick<UpdateTodoInput, "title" | "details">,
): TodoChanges {
  const set: TodoChanges = {};
  if (patch.title !== undefined && patch.title !== todo.title) {
    set.title = patch.title;
  }
  if (patch.details !== undefined) {
    const details = patch.details || null;
    if (details !== todo.details) set.details = details;
  }
  return set;
}

/**
 * Planned day and Reminder: a new day sends the To-do to the bottom of that
 * bucket, and a changed moment re-arms the Reminder (see `updatedSchedule`).
 */
function scheduleChanges(
  tx: Tx,
  todo: TodoRecord,
  patch: Pick<UpdateTodoInput, "day" | "time">,
  zone: string,
  now: Date,
): TodoChanges {
  const { day, reminder } = updatedSchedule(todo, patch, zone, now);
  const set: TodoChanges = { ...reminder };
  if (day !== todo.day) {
    set.day = day;
    set.position = bottomOfBucket(tx, { day, parentId: todo.parentId });
  }
  return set;
}

/**
 * Closing sets `closed_at` (and closes open Sub-to-dos, see
 * `closeOpenSubTodos`); reopening clears it. A Reminder is untouched when
 * closing; when reopening, `schedule` is the To-do as the patch leaves it,
 * and a pending Reminder already past is skipped.
 */
function stateChanges(
  tx: Tx,
  todo: TodoRecord,
  patch: Pick<UpdateTodoInput, "state" | "closeSubTodos">,
  schedule: TodoChanges,
  zone: string,
  now: Date,
): TodoChanges {
  if (patch.state === undefined || patch.state === todo.state) return {};
  if (patch.state !== "open") {
    closeOpenSubTodos(
      tx,
      todo.id,
      patch.state,
      now.toISOString(),
      patch.closeSubTodos,
    );
    return { state: patch.state, closedAt: now.toISOString() };
  }
  const skipped = skippedOnReopen({ ...todo, ...schedule }, zone, now);
  return { state: "open", closedAt: null, ...skipped };
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
  /** `ctx.write`, then tells the Reminder scheduler (§4: every write reschedules). */
  const write = <T>(fn: (tx: Tx) => T): T => {
    const result = ctx.write(fn);
    ctx.onTodosChanged();
    return result;
  };

  return {
    /**
     * Creates an open To-do at the bottom of its bucket. `tokenName` is the
     * creating Token's name, kept as the To-do's `source`.
     */
    create(actor: Actor, tokenName: string, input: CreateTodoInput): TodoView {
      const data = parseInput(createTodoInputSchema, input);
      return write((tx) => {
        const now = new Date();
        const stamp = now.toISOString();
        const parentId = data.parentId ?? null;
        if (parentId !== null) requireParent(tx, parentId);
        const { day, reminder } = newSchedule(data, ctx.ownerTimezone, now);
        const row = tx
          .insert(todos)
          .values({
            id: newId(),
            title: data.title,
            day,
            ...reminder,
            parentId,
            position: bottomOfBucket(tx, { day, parentId }),
            details: data.details || null,
            createdBy: actor,
            createdByToken: tokenName,
            createdAt: stamp,
            updatedAt: stamp,
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
     * same write. `time` sets or (null) removes the Reminder; `day: null`
     * removes it too; a changed moment must be in the future and re-arms it.
     * A stale `expectedUpdatedAt` is a `conflict` too.
     */
    update(id: string, input: UpdateTodoInput): TodoView {
      const { expectedUpdatedAt, closeSubTodos, ...patch } = parseInput(
        updateTodoInputSchema,
        input,
      );
      if (Object.values(patch).every((value) => value === undefined)) {
        throw new ServiceError("validation_error", "No fields to update");
      }
      return write((tx) => {
        const todo = requireLiveTodo(tx, id);
        requireFresh(todo, expectedUpdatedAt);
        const now = new Date();
        const schedule = scheduleChanges(
          tx,
          todo,
          patch,
          ctx.ownerTimezone,
          now,
        );
        const set: TodoChanges = {
          ...contentChanges(todo, patch),
          ...schedule,
          ...stateChanges(
            tx,
            todo,
            { state: patch.state, closeSubTodos },
            schedule,
            ctx.ownerTimezone,
            now,
          ),
        };

        if (Object.keys(set).length === 0) return view(tx, todo);
        const row = tx
          .update(todos)
          .set({ ...set, updatedAt: now.toISOString() })
          .where(eq(todos.id, todo.id))
          .returning()
          .get();
        if (set.title !== undefined) deriveReferences(tx, row.id, row.title);
        return view(tx, row);
      });
    },

    /**
     * Moves a live To-do within its bucket (same Planned day or Anytime, same
     * parent). `beforeId` places it directly above that To-do, `afterId`
     * directly below; with both they must be adjacent; with neither it goes
     * to the bottom. A neighbour that is deleted, unknown or in another
     * bucket is a `validation_error`. Same fractional algorithm as the Issue
     * columns: the bucket is rebalanced (without touching `updated_at`) when
     * the gap gets too small. A stale `expectedUpdatedAt` is a `conflict`.
     */
    move(id: string, input: MoveTodoPositionInput): TodoView {
      const data = parseInput(moveTodoPositionInputSchema, input);
      return write((tx) => {
        const todo = requireLiveTodo(tx, id);
        requireFresh(todo, data.expectedUpdatedAt);
        const bucket = tx
          .select()
          .from(todos)
          .where(and(inBucket(todo), ne(todos.id, todo.id)))
          .orderBy(asc(todos.position), asc(todos.id))
          .all();

        const invalid = (field: "beforeId" | "afterId", message: string) =>
          new ServiceError("validation_error", message, {
            fields: { [field]: [message] },
          });
        const indexOf = (field: "beforeId" | "afterId", ref: string) => {
          const i = bucket.findIndex((t) => t.id === ref);
          if (i < 0) {
            throw invalid(
              field,
              `${field} must be another live To-do in the same bucket (same Planned day, same parent)`,
            );
          }
          return i;
        };
        let index = bucket.length;
        if (data.afterId !== undefined) {
          index = indexOf("afterId", data.afterId) + 1;
        }
        if (data.beforeId !== undefined) {
          const beforeIndex = indexOf("beforeId", data.beforeId);
          if (data.afterId !== undefined && beforeIndex !== index) {
            throw invalid(
              "beforeId",
              "beforeId and afterId must be adjacent To-dos",
            );
          }
          index = beforeIndex;
        }

        const position = slotPosition(
          bucket,
          index,
          (t) => t.position,
          () => rebalance(tx, bucket),
        );
        const row = tx
          .update(todos)
          .set({ position, updatedAt: nowIso() })
          .where(eq(todos.id, todo.id))
          .returning()
          .get();
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
