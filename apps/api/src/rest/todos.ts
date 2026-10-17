import { createTodoInputSchema, listTodosQuerySchema } from "@traccia/shared";
import type { Hono } from "hono";
import { type TodoView, todoUrl } from "../service/index.js";
import type { AppContainer, AppEnv } from "./env.js";
import { servicesFor } from "./services.js";
import { validateBody, validateQuery } from "./validate.js";

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
}
