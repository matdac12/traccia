import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, createApiClient } from "../lib/api/client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function client(res: Response) {
  const fetchMock = vi.fn(async () => res);
  return { fetchMock, api: createApiClient({ baseUrl: "http://api:8787", token: "tok_secret", fetch: fetchMock as never }) };
}

describe("api client", () => {
  it("sends the bearer token, builds the query and parses the response", async () => {
    const { api, fetchMock } = client(json({ n: 1 }));
    const out = await api.request("/things", {
      schema: z.object({ n: z.number() }),
      query: { status: ["todo", "done"], limit: 5, skip: undefined },
    });
    expect(out).toEqual({ n: 1 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("http://api:8787/v1/things?status=todo&status=done&limit=5");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok_secret");
  });
  it("sends body and If-Match on writes", async () => {
    const { api, fetchMock } = client(json({ ok: true }));
    await api.request("/issues/MAT-1", { schema: z.object({ ok: z.boolean() }), method: "PATCH", body: { title: "x" }, ifMatch: "2026-01-01T00:00:00Z" });
    const init = (fetchMock.mock.calls[0] as unknown as [URL, RequestInit])[1];
    expect(init.body).toBe('{"title":"x"}');
    expect((init.headers as Record<string, string>)["if-match"]).toBe("2026-01-01T00:00:00Z");
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
    const api = createApiClient({ baseUrl: "http://api:8787", token: "t", fetch: (async () => { throw new Error("ECONNREFUSED"); }) as never });
    const err = (await api.request("/x", { schema: z.unknown() }).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("unreachable");
  });
});
