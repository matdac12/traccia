import { SHARED_PLACEHOLDER } from "@linear-matti/shared";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { paginationQuery, toPage } from "../src/rest/pagination.js";
import { validateBody, validateQuery } from "../src/rest/validate.js";
import {
  ConflictError,
  ERROR_STATUS,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
} from "../src/service/errors.js";
import { createTestApp } from "./helpers/test-app.js";

describe("GET /healthz", () => {
  it("returns exactly { ok: true }", async () => {
    const { app } = createTestApp();
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("error shape", () => {
  const cases = [
    ["unauthorized", () => new UnauthorizedError()],
    ["forbidden", () => new ForbiddenError()],
    ["not_found", () => new NotFoundError()],
    ["validation_error", () => new ValidationError()],
    ["conflict", () => new ConflictError("dup", { field: "key" })],
    ["rate_limited", () => new RateLimitedError()],
  ] as const;

  it.each(cases)("maps %s to its status and body", async (code, make) => {
    const { app } = createTestApp();
    app.get("/boom", () => {
      throw make();
    });
    const res = await app.request("/boom");
    expect(res.status).toBe(ERROR_STATUS[code]);
    const body = (await res.json()) as { error: Record<string, unknown> };
    expect(body.error.code).toBe(code);
    expect(typeof body.error.message).toBe("string");
    expect(body.error.details).toBeTypeOf("object");
  });

  it("keeps service error details", async () => {
    const { app } = createTestApp();
    app.get("/boom", () => {
      throw new ConflictError("dup", { field: "key" });
    });
    const body = await (await app.request("/boom")).json();
    expect(body).toEqual({
      error: { code: "conflict", message: "dup", details: { field: "key" } },
    });
  });

  it("turns unknown errors into internal without leaking the stack, and logs them", async () => {
    const { app, logs } = createTestApp();
    app.get("/boom", () => {
      throw new Error("secret detail at /src/db.ts:42");
    });
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      error: {
        code: "internal",
        message: "Internal server error",
        details: {},
      },
    });
    expect(text).not.toContain("secret detail");
    expect(text).not.toContain("db.ts");
    expect(logs.some((l) => l.includes("secret detail"))).toBe(true);
  });

  it("returns not_found for unknown routes", async () => {
    const { app } = createTestApp();
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "not_found",
    );
  });
});

describe("HTTPException mapping", () => {
  it("keeps 401/403/429 statuses", async () => {
    const { app } = createTestApp();
    app.get("/u", () => {
      throw new HTTPException(401, { message: "no" });
    });
    app.get("/r", () => {
      throw new HTTPException(429);
    });
    expect((await app.request("/u")).status).toBe(401);
    expect((await app.request("/r")).status).toBe(429);
  });
});

describe("validation helpers", () => {
  it("returns field details for a Zod failure in the body", async () => {
    const { app } = createTestApp();
    const schema = z.object({ title: z.string().min(1), n: z.number() });
    app.post("/things", async (c) => c.json(await validateBody(c, schema)));
    const res = await app.request("/things", {
      method: "POST",
      body: JSON.stringify({ title: "", n: "x" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; details: { fields: Record<string, string[]> } };
    };
    expect(body.error.code).toBe("validation_error");
    expect(Object.keys(body.error.details.fields).sort()).toEqual([
      "n",
      "title",
    ]);
  });

  it("rejects malformed JSON with validation_error", async () => {
    const { app } = createTestApp();
    app.post("/things", async (c) =>
      c.json(await validateBody(c, z.object({}))),
    );
    const res = await app.request("/things", { method: "POST", body: "{nope" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "validation_error",
    );
  });

  it("validates query strings, collecting repeated keys", async () => {
    const { app } = createTestApp();
    app.get("/q", (c) =>
      c.json(
        validateQuery(
          c,
          z.object({ status: z.array(z.string()).or(z.string()) }),
        ),
      ),
    );
    const res = await app.request("/q?status=a&status=b");
    expect(await res.json()).toEqual({ status: ["a", "b"] });
  });
});

describe("pagination", () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: i + 1 }));

  function listApp() {
    const { app } = createTestApp();
    app.get("/items", (c) => {
      const { limit, cursor } = validateQuery(c, paginationQuery);
      const after = (cursor as { after: number } | undefined)?.after ?? 0;
      const slice = rows.filter((r) => r.id > after).slice(0, limit + 1);
      return c.json(toPage(slice, limit, (last) => ({ after: last.id })));
    });
    return app;
  }

  it("round-trips through nextCursor to the end", async () => {
    const app = listApp();
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/items?limit=3${cursor ? `&cursor=${cursor}` : ""}`;
      const page = (await (await app.request(url)).json()) as {
        items: { id: number }[];
        nextCursor: string | null;
      };
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pages).toBe(3);
  });

  it("clamps limit to 250 and defaults to 50", () => {
    expect(paginationQuery.parse({ limit: "9999" }).limit).toBe(250);
    expect(paginationQuery.parse({}).limit).toBe(50);
  });

  it.each(["0", "-1", "abc"])("rejects limit=%s", async (limit) => {
    const res = await listApp().request(`/items?limit=${limit}`);
    expect(res.status).toBe(400);
  });

  it.each(["not-a-cursor!!", "bm90anNvbg", "bnVsbA", "NQ"])(
    "rejects bad cursor %s",
    async (cursor) => {
      const res = await listApp().request(`/items?cursor=${cursor}`);
      expect(res.status).toBe(400);
      expect(
        ((await res.json()) as { error: { code: string } }).error.code,
      ).toBe("validation_error");
    },
  );
});

describe("request logging", () => {
  it("never logs the Authorization header and sets a request id", async () => {
    const { app, logs } = createTestApp();
    const res = await app.request("/healthz", {
      headers: { Authorization: "Bearer super-secret-token" },
    });
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toContain("super-secret-token");
    expect(logs.join("\n").toLowerCase()).not.toContain("authorization");
  });

  it("does not log Authorization even when the handler throws", async () => {
    const { app, logs } = createTestApp();
    app.get("/boom", () => {
      throw new Error("x");
    });
    await app.request("/boom", {
      headers: { Authorization: "Bearer super-secret-token" },
    });
    expect(logs.join("\n")).not.toContain("super-secret-token");
  });

  it("honours LOG_LEVEL", async () => {
    const { app, logs } = createTestApp({ LOG_LEVEL: "error" });
    await app.request("/healthz");
    expect(logs).toEqual([]);
  });
});

describe("TRUST_PROXY", () => {
  it("uses the last X-Forwarded-For entry when trusted", async () => {
    const { app, logs } = createTestApp({ TRUST_PROXY: "true" });
    await app.request("/healthz", {
      headers: { "x-forwarded-for": "6.6.6.6, 100.64.0.9" },
    });
    expect(JSON.parse(logs[0] as string).ip).toBe("100.64.0.9");
  });

  it("ignores X-Forwarded-For when not trusted", async () => {
    const { app, logs } = createTestApp({ TRUST_PROXY: "false" });
    await app.request("/healthz", {
      headers: { "x-forwarded-for": "6.6.6.6" },
    });
    expect(JSON.parse(logs[0] as string).ip).toBeUndefined();
  });
});

describe("workspace wiring", () => {
  it("imports from @linear-matti/shared", () => {
    expect(SHARED_PLACEHOLDER).toBe("shared-ok");
  });
});
