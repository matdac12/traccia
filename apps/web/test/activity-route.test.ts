import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../lib/api/client";

const fetchMock = vi.fn();
vi.mock("../lib/api/client", async (orig) => {
  const mod = await orig<typeof import("../lib/api/client")>();
  const client = mod.createApiClient({ baseUrl: "http://api", token: "trk_secret_token", fetch: ((...a: unknown[]) => fetchMock(...a)) as never });
  return { ...mod, api: () => client };
});

const feedItem = { id: "a1", issueId: "i1", actor: "agent", type: "status_changed", data: { from: "todo", to: "done" }, createdAt: "2026-01-01T00:00:00.000Z", identifier: "TRC-1", title: "One" };
const req = (query: string) => new Request(`http://dash/api/activity?${query}`);
beforeEach(() => {
  fetchMock.mockReset();
  void createApiClient;
});

describe("GET /api/activity", () => {
  it("pages one project's activity feed through the server-side token", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ items: [feedItem], nextCursor: "c2" }));
    const { GET } = await import("../app/api/activity/route");
    const res = await GET(req("project=p1&cursor=c1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [feedItem], nextCursor: "c2" });
    const [url, init] = fetchMock.mock.calls[0]!;
    const sent = new URL(String(url));
    expect(sent.pathname).toBe("/v1/activity");
    expect(sent.searchParams.get("project")).toBe("p1");
    expect(sent.searchParams.get("cursor")).toBe("c1");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer trk_secret_token" });
  });

  it("rejects a missing project or cursor without calling the API", async () => {
    const { GET } = await import("../app/api/activity/route");
    expect((await GET(req("cursor=c1"))).status).toBe(400);
    expect((await GET(req("project=p1"))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps an API failure to the standard error shape", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: "not_found", message: "no" } }, { status: 404 }));
    const { GET } = await import("../app/api/activity/route");
    const res = await GET(req("project=p1&cursor=c1"));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it("returns 502 when the API is unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { GET } = await import("../app/api/activity/route");
    expect((await GET(req("project=p1&cursor=c1"))).status).toBe(502);
  });
});
