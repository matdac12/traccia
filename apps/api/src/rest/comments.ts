import {
  createCommentInputSchema,
  deleteQuerySchema,
  updateCommentInputSchema,
} from "@traccia/shared";
import type { Hono } from "hono";
import type { AppContainer, AppEnv } from "./env.js";
import { servicesFor } from "./services.js";
import { validateBody, validateQuery } from "./validate.js";

/** Comment routes. Only the actor who wrote a comment may edit it (service rule). */
export function mountCommentRoutes(v1: Hono<AppEnv>, container: AppContainer) {
  const { comments, trash } = servicesFor(container);

  v1.get("/issues/:identifier/comments", (c) =>
    c.json({ items: comments.list(c.req.param("identifier")) }),
  );

  v1.post("/issues/:identifier/comments", async (c) => {
    const body = await validateBody(c, createCommentInputSchema);
    return c.json(
      comments.create(c.get("actor"), c.req.param("identifier"), body),
      201,
    );
  });

  v1.patch("/comments/:id", async (c) => {
    const body = await validateBody(c, updateCommentInputSchema);
    return c.json(comments.update(c.get("actor"), c.req.param("id"), body));
  });

  v1.delete("/comments/:id", async (c) => {
    const { purge } = validateQuery(c, deleteQuerySchema);
    const result = await trash.delete(
      c.get("actor"),
      "comment",
      c.req.param("id"),
      { purge },
    );
    return c.json({ ...result, purged: purge === true });
  });
}
