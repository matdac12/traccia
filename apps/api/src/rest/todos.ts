import {
  createTodoInputSchema,
  listTodosQuerySchema,
  updateTodoInputSchema,
} from "@traccia/shared";
import type { Hono } from "hono";
import { type TodoView, todoUrl } from "../service/index.js";
import type { AppContainer, AppEnv } from "./env.js";
import { servicesFor } from "./services.js";
import { ifMatch, validateBody, validateQuery } from "./validate.js";

/** Personal Space To-dos: thin adapter over `services.todos` (ADR 0017: REST only). */
export function mountTodoRoutes(v1: Hono<AppEnv>, container: AppContainer) {
  const { todos } = servicesFor(container);
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

  v1.get("/todos/:id", (c) => c.json(withUrl(todos.get(c.req.param("id")))));

  v1.patch("/todos/:id", async (c) => {
    const body = await validateBody(c, updateTodoInputSchema);
    // The body field wins over the header when both are present.
    body.expectedUpdatedAt ??= ifMatch(c);
    return c.json(withUrl(todos.update(c.req.param("id"), body)));
  });
}
