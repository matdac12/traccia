import {
  createTodoInputSchema,
  deleteQuerySchema,
  listTodosQuerySchema,
  moveTodoPositionInputSchema,
  updateTodoInputSchema,
} from "@traccia/shared";
import type { Hono } from "hono";
import { initialDelivery } from "../reminders/scheduler.js";
import { type TodoView, todoUrl } from "../service/index.js";
import type { AppContainer, AppEnv } from "./env.js";
import { servicesFor } from "./services.js";
import { ifMatch, validateBody, validateQuery } from "./validate.js";

/** Personal Space To-dos: thin adapter over `services.todos` (ADR 0017: REST only). */
export function mountTodoRoutes(v1: Hono<AppEnv>, container: AppContainer) {
  const { todos, trash } = servicesFor(container);
  const withUrl = (t: TodoView) => ({
    ...t,
    url: todoUrl(container.config.baseUrl, t.id),
  });

  v1.get("/todos", (c) => {
    const page = todos.list(validateQuery(c, listTodosQuerySchema));
    return c.json({ ...page, items: page.items.map(withUrl) });
  });

  v1.post("/todos", async (c) => {
    const input = await validateBody(c, createTodoInputSchema);
    return c.json(
      withUrl(todos.create(c.get("actor"), c.get("tokenName"), input)),
      201,
    );
  });

  // Before `/todos/:id`, which would take "delivery" as an id.
  v1.get("/todos/delivery", (c) =>
    c.json(
      container.reminders?.delivery() ??
        initialDelivery(container.config.telegram !== undefined),
    ),
  );

  v1.get("/todos/:id", (c) => c.json(withUrl(todos.get(c.req.param("id")))));

  v1.get("/todos/:id/sub-todos", (c) =>
    c.json({ items: todos.listSubTodos(c.req.param("id")).map(withUrl) }),
  );

  v1.patch("/todos/:id", async (c) => {
    const body = await validateBody(c, updateTodoInputSchema);
    // The body field wins over the header when both are present.
    body.expectedUpdatedAt ??= ifMatch(c);
    return c.json(withUrl(todos.update(c.req.param("id"), body)));
  });

  v1.patch("/todos/:id/position", async (c) => {
    const body = await validateBody(c, moveTodoPositionInputSchema);
    body.expectedUpdatedAt ??= ifMatch(c);
    return c.json(withUrl(todos.move(c.req.param("id"), body)));
  });

  // Soft delete (Sub-to-dos join the batch); `?purge=true` removes a deleted
  // To-do for good, `you` only. Restore is `POST /v1/restore`.
  v1.delete("/todos/:id", async (c) => {
    const { purge } = validateQuery(c, deleteQuerySchema);
    const result = await trash.delete(
      c.get("actor"),
      "todo",
      c.req.param("id"),
      { purge },
    );
    return c.json({ ...result, purged: purge === true });
  });
}
