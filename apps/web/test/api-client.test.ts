import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, createApiClient } from "../lib/api/client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function client(res: Response) {
  const fetchMock = vi.fn(async () => res);
  return { fetchMock, api: createApiClient({ baseUrl: "http://api:8787", token: "tok_secret", fetch: fetchMock as never }) };
}

describe("api client 429 handling", () => {
  const rateLimited = () => json({ error: { code: "rate_limited", message: "Rate limit exceeded", details: {} } }, 429);
  const make = (responses: Response[]) => {
    const fetchMock = vi.fn(async () => responses.shift()!);
    const sleep = vi.fn(async () => {});
    const api = createApiClient({ baseUrl: "http://api:8787", token: "t", fetch: fetchMock as never, sleep });
    return { fetchMock, sleep, api };
  };
  const schema = z.object({ n: z.number() });

  it("retries once after Retry-After and returns the result", async () => {
    const limited = new Response(null, { status: 429, headers: { "retry-after": "2" } });
    const { api, fetchMock, sleep } = make([limited, json({ n: 1 })]);
    expect(await api.request("/x", { schema })).toEqual({ n: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });
  it("caps the wait", async () => {
    const limited = new Response(null, { status: 429, headers: { "retry-after": "60" } });
    const { api, sleep } = make([limited, json({ n: 1 })]);
    await api.request("/x", { schema });
    expect(sleep).toHaveBeenCalledWith(5000);
  });
  it("gives up after one retry with a rate_limited ApiError", async () => {
    const { api, fetchMock } = make([rateLimited(), rateLimited()]);
    await expect(api.request("/x", { schema })).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("api client", () => {
  it("sends the bearer token, builds the query and parses the response", async () => {
    const { api, fetchMock } = client(json({ n: 1 }));
    const out = await api.request("/things", {
      schema: z.object({ n: z.number() }),
      querySchema: z.object({ status: z.array(z.string()), limit: z.coerce.number(), skip: z.string().optional() }),
      query: { status: ["todo", "done"], limit: 5, skip: undefined },
    });
    expect(out).toEqual({ n: 1 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("http://api:8787/v1/things?status=todo&status=done&limit=5");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok_secret");
  });
  it("sends body and If-Match on writes", async () => {
    const { api, fetchMock } = client(json({ ok: true }));
    await api.request("/issues/MAT-1", { schema: z.object({ ok: z.boolean() }), method: "PATCH", bodySchema: z.object({ title: z.string() }), body: { title: "x" }, ifMatch: "2026-01-01T00:00:00Z" });
    const init = (fetchMock.mock.calls[0] as unknown as [URL, RequestInit])[1];
    expect(init.body).toBe('{"title":"x"}');
    expect((init.headers as Record<string, string>)["if-match"]).toBe("2026-01-01T00:00:00Z");
  });
  it("refuses a query or body the request schema rejects, before anything is sent (TRC-137)", async () => {
    const { api, fetchMock } = client(json({}));
    const querySchema = z.object({ query: z.string().min(1).optional() });
    await expect(api.request("/x", { schema: z.unknown(), querySchema, query: { query: "" } })).rejects.toMatchObject({ code: "validation_error" });
    const bodySchema = z.object({ title: z.string() });
    // @ts-expect-error `title` is required
    await expect(api.request("/x", { schema: z.unknown(), method: "POST", bodySchema, body: {} })).rejects.toMatchObject({ code: "validation_error" });
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
  it("turns API error bodies into ApiError with code and details", async () => {
    const { api } = client(json({ error: { code: "conflict", message: "stale", details: { currentUpdatedAt: "t" } } }, 409));
    await expect(api.request("/x", { schema: z.unknown() })).rejects.toMatchObject({
      status: 409,
      code: "conflict",
      details: { currentUpdatedAt: "t" },
    });
  });
  it("rejects a response that does not match the schema", async () => {
    const { api } = client(json({ n: "nope" }));
    await expect(api.request("/x", { schema: z.object({ n: z.number() }) })).rejects.toMatchObject({ code: "bad_response" });
  });
  it("reports an unreachable API", async () => {
    const api = createApiClient({
      baseUrl: "http://api:8787",
      token: "t",
      fetch: (async () => {
        throw new Error("ECONNREFUSED");
      }) as never,
    });
    const err = (await api.request("/x", { schema: z.unknown() }).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("unreachable");
  });
});

describe("api client conditional reads", () => {
  const schema = z.object({ n: z.number() });
  const make = (...responses: Response[]) => {
    const fetchMock = vi.fn(async () => responses.shift()!);
    return { fetchMock, api: createApiClient({ baseUrl: "http://api:8787", token: "t", fetch: fetchMock as never }) };
  };
  const tagged = (body: unknown, etag: string) => new Response(JSON.stringify(body), { headers: { etag } });
  const sent = (fetchMock: ReturnType<typeof vi.fn>, call: number) => ((fetchMock.mock.calls[call] as unknown as [URL, RequestInit])[1].headers as Record<string, string>)["if-none-match"];

  it("sends If-None-Match with the kept tag and returns the kept answer on a 304", async () => {
    const { api, fetchMock } = make(tagged({ n: 1 }, '"a"'), new Response(null, { status: 304, headers: { etag: '"a"' } }));
    const first = await api.request("/todos", { schema, conditional: true });
    expect(sent(fetchMock, 0)).toBeUndefined();
    const second = await api.request("/todos", { schema, conditional: true });
    expect(sent(fetchMock, 1)).toBe('"a"');
    expect(second).toBe(first);
  });

  it("returns and keeps the new answer when it changed", async () => {
    const { api, fetchMock } = make(tagged({ n: 1 }, '"a"'), tagged({ n: 2 }, '"b"'), new Response(null, { status: 304 }));
    await api.request("/todos", { schema, conditional: true });
    expect(await api.request("/todos", { schema, conditional: true })).toEqual({ n: 2 });
    expect(sent(fetchMock, 1)).toBe('"a"');
    expect(await api.request("/todos", { schema, conditional: true })).toEqual({ n: 2 });
    expect(sent(fetchMock, 2)).toBe('"b"');
  });

  it("forgets the kept answer when a 200 comes without a tag", async () => {
    const { api, fetchMock } = make(tagged({ n: 1 }, '"a"'), json({ n: 2 }), json({ n: 3 }));
    await api.request("/todos", { schema, conditional: true });
    await api.request("/todos", { schema, conditional: true });
    await api.request("/todos", { schema, conditional: true });
    expect(sent(fetchMock, 2)).toBeUndefined();
  });

  it("keeps one answer per URL, query included", async () => {
    const { api, fetchMock } = make(tagged({ n: 1 }, '"a"'), tagged({ n: 2 }, '"b"'));
    await api.request("/todos?x=1", { schema, conditional: true });
    await api.request("/todos?x=2", { schema, conditional: true });
    expect(sent(fetchMock, 1)).toBeUndefined();
  });

  it("does nothing without `conditional`, and never for a write", async () => {
    const { api, fetchMock } = make(tagged({ n: 1 }, '"a"'), tagged({ n: 1 }, '"a"'), tagged({ n: 1 }, '"a"'), tagged({ n: 1 }, '"a"'));
    await api.request("/todos", { schema });
    await api.request("/todos", { schema });
    expect(sent(fetchMock, 1)).toBeUndefined();
    await api.request("/todos", { schema, conditional: true });
    await api.request("/todos", { schema, method: "PATCH", conditional: true });
    expect(sent(fetchMock, 3)).toBeUndefined();
  });

  it("still fails on an error answer, and a 304 with nothing kept is an error rather than an empty page", async () => {
    const { api } = make(new Response(null, { status: 304 }));
    await expect(api.request("/todos", { schema, conditional: true })).rejects.toMatchObject({ status: 304 });
  });
});
