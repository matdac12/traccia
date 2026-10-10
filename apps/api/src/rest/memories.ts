import { purgeQuerySchema } from "@traccia/shared";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppContainer, AppEnv } from "./env.js";
import { servicesFor } from "./services.js";
import { ifMatch, validateBody, validateQuery } from "./validate.js";

const listQuery = z.object({
  query: z.string().min(1).optional(),
  /** Repeated `?tags=a&tags=b` (AND) or one comma-separated value. */
  tags: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v === undefined
        ? undefined
        : (Array.isArray(v) ? v : [v])
            .flatMap((t) => t.split(","))
            .map((t) => t.trim())
            .filter(Boolean),
    ),
  includeDeleted: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).optional(),
  cursor: z.string().min(1).optional(),
});

const memoryBody = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  tags: z.array(z.string()).optional(),
  expectedUpdatedAt: z.string().min(1).optional(),
});

/** Project memories: thin adapter over `services.memories` / `services.trash`. */
export function mountMemoryRoutes(v1: Hono<AppEnv>, container: AppContainer) {
  const { memories, trash } = servicesFor(container);

  v1.get("/projects/:idOrKey/memories", (c) => {
    const q = validateQuery(c, listQuery);
    return c.json(memories.list(c.req.param("idOrKey"), q));
  });

  v1.post("/projects/:idOrKey/memories", async (c) => {
    const input = await validateBody(c, memoryBody);
    return c.json(
      memories.save(c.get("actor"), {
        ...input,
        project: c.req.param("idOrKey"),
        id: undefined,
        expectedUpdatedAt: undefined,
      }),
      201,
    );
  });

  v1.get("/memories/:id", (c) => c.json(memories.get(c.req.param("id"))));

  v1.patch("/memories/:id", async (c) => {
    const input = await validateBody(c, memoryBody);
    input.expectedUpdatedAt ??= ifMatch(c);
    return c.json(
      memories.save(c.get("actor"), { ...input, id: c.req.param("id") }),
    );
  });

  v1.delete("/memories/:id", async (c) => {
    const { purge } = validateQuery(c, purgeQuerySchema);
    const result = await trash.delete(
      c.get("actor"),
      "memory",
      c.req.param("id"),
      { purge },
    );
    return c.json({ ...result, deleted: true, purged: purge === true });
  });
}
