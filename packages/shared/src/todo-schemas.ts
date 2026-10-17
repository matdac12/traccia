import { z } from "zod";
import { queryBooleanSchema } from "./rest-catalog-schemas.js";
import { dateOnlySchema } from "./schemas.js";

// Personal Space To-dos (docs/personal-space.md §5): request and response
// schemas shared by the API and the dashboard.

export const TODO_STATES = ["open", "done", "dropped"] as const;
export type TodoState = (typeof TODO_STATES)[number];

export const REMINDER_STATUSES = [
  "pending",
  "sent",
  "failed",
  "skipped",
] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const REMINDER_FAILURES = [
  "telegram_unauthorized",
  "telegram_forbidden",
  "telegram_rejected",
  "gave_up",
] as const;
export type ReminderFailure = (typeof REMINDER_FAILURES)[number];

export const TODO_TITLE_MAX = 500;

/** 1 to 500 characters after trimming; `@KEY`s stay in the text. */
export const todoTitleSchema = z
  .string()
  .trim()
  .min(1, "must not be empty")
  .max(TODO_TITLE_MAX, `must be at most ${TODO_TITLE_MAX} characters`);

/** A To-do as the API returns it. */
export const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  references: z.array(
    z.object({
      key: z.string(),
      projectId: z.string(),
      projectDeleted: z.boolean(),
    }),
  ),
  /** Planned day, `YYYY-MM-DD` in the Owner timezone; null is Anytime. */
  day: z.string().nullable(),
  reminder: z
    .object({
      /** `HH:MM` on the Planned day, in the Owner timezone. */
      time: z.string(),
      status: z.enum(REMINDER_STATUSES),
      failure: z.enum(REMINDER_FAILURES).nullable(),
      sentAt: z.string().nullable(),
    })
    .nullable(),
  state: z.enum(TODO_STATES),
  closedAt: z.string().nullable(),
  parentId: z.string().nullable(),
  position: z.number(),
  details: z.string().nullable(),
  /** Name of the Token that created it ("via Parla"). */
  source: z.string(),
  /** `${BASE_URL}/personal?todo=<id>`: opens it in the dashboard. */
  url: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deleted: z.literal(true).optional(),
});
export type Todo = z.infer<typeof todoSchema>;

/** `HH:MM`, 00:00 to 23:59: the time of a Reminder on the Planned day. */
export const reminderTimeSchema = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d$/,
    "must be formatted HH:MM (00:00 to 23:59)",
  );

/** An ISO 8601 moment that carries its UTC offset (or `Z`). */
export const remindAtSchema = z.iso.datetime({
  offset: true,
  error:
    "must be an ISO 8601 date and time with an offset, e.g. 2026-10-18T15:00:00+02:00",
});

/** `POST /v1/todos`. */
export const createTodoInputSchema = z
  .object({
    title: todoTitleSchema,
    /** Omit or null for Anytime. */
    day: dateOnlySchema.nullable().optional(),
    /**
     * Sets a Reminder at this time on `day` (today when `day` is omitted), in
     * the Owner timezone. Not together with `remindAt`.
     */
    time: reminderTimeSchema.optional(),
    /**
     * Sets the Reminder from one moment: it becomes `day` and `time` in the
     * Owner timezone, seconds dropped. Not together with `time`.
     */
    remindAt: remindAtSchema.optional(),
    /** Makes it a Sub-to-do: an open, top-level, live To-do. */
    parentId: z.string().min(1).optional(),
    /** Markdown. */
    details: z.string().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.time !== undefined && input.remindAt !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["remindAt"],
        message: "must not be sent together with time",
      });
    }
    if (input.time !== undefined && input.day === null) {
      ctx.addIssue({
        code: "custom",
        path: ["time"],
        message: "needs a day: omit day or send one",
      });
    }
  });
export type CreateTodoInput = z.input<typeof createTodoInputSchema>;

/**
 * `PATCH /v1/todos/:id`: partial. `day: null` makes it Anytime and removes the
 * Reminder; `time` sets the Reminder (`null` removes it); an empty `details`
 * clears it. `closeSubTodos` only matters when `state` closes a To-do that has
 * open Sub-to-dos.
 */
export const updateTodoInputSchema = z
  .object({
    title: todoTitleSchema.optional(),
    day: dateOnlySchema.nullable().optional(),
    time: reminderTimeSchema.nullable().optional(),
    details: z.string().optional(),
    state: z.enum(TODO_STATES).optional(),
    closeSubTodos: z.boolean().optional(),
    /** Optimistic concurrency: the `updatedAt` the caller last saw. */
    expectedUpdatedAt: z.string().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.day === null && typeof input.time === "string") {
      ctx.addIssue({
        code: "custom",
        path: ["time"],
        message: "cannot be set while day is null: Anytime has no Reminder",
      });
    }
  });
export type UpdateTodoInput = z.input<typeof updateTodoInputSchema>;

/**
 * `PATCH /v1/todos/:id/position`: place the To-do directly above `beforeId` or
 * directly below `afterId` (both must then be adjacent), within its bucket;
 * with neither it goes to the bottom.
 */
export const moveTodoPositionInputSchema = z.object({
  beforeId: z.string().min(1).optional(),
  afterId: z.string().min(1).optional(),
  /** Optimistic concurrency: the `updatedAt` the caller last saw. */
  expectedUpdatedAt: z.string().optional(),
});
export type MoveTodoPositionInput = z.input<typeof moveTodoPositionInputSchema>;

/**
 * `open`: every open To-do, Sub-to-dos included, by day (Anytime last), then
 * Position. `closed`: the Logbook, most recently closed first.
 */
export const TODO_LIST_STATES = ["open", "closed"] as const;

export const listTodosInputSchema = z.object({
  state: z.enum(TODO_LIST_STATES),
  includeDeleted: z.boolean().optional(),
  limit: z.number().int().min(1).optional(),
  cursor: z.string().min(1).optional(),
});
export type ListTodosInput = z.input<typeof listTodosInputSchema>;

/** `GET /v1/todos`: the list input, with numbers and booleans as text. */
export const listTodosQuerySchema = listTodosInputSchema.extend({
  includeDeleted: queryBooleanSchema.optional(),
  limit: z.coerce.number().int().min(1).optional(),
});

/** Why Reminders can't go out (`GET /v1/todos/delivery`, §6.4). */
export const TODO_DELIVERY_REASONS = [
  "not_configured",
  "telegram_unauthorized",
  "telegram_forbidden",
] as const;
export type TodoDeliveryReason = (typeof TODO_DELIVERY_REASONS)[number];

/**
 * `GET /v1/todos/delivery`: whether Reminders are being delivered, held in the
 * API's memory. `reason` is set when `ok` is false; `lastSentAt` is the last
 * successful send since the API started.
 */
export const todoDeliverySchema = z.object({
  ok: z.boolean(),
  reason: z.enum(TODO_DELIVERY_REASONS).optional(),
  lastSentAt: z.string().optional(),
});
export type TodoDelivery = z.infer<typeof todoDeliverySchema>;
