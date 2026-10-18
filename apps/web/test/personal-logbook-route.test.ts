import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("../lib/api/client", async (orig) => {
  const mod = await orig<typeof import("../lib/api/client")>();
  const client = mod.createApiClient({ baseUrl: "http://api", token: "trk_secret_token", fetch: ((...a: unknown[]) => fetchMock(...a)) as never });
  return { ...mod, api: () => client };
});

const closed = {
  id: "01DONE",
  title: "Renew the passport",
  references: [],
  day: "2026-10-02",
  reminder: null,
  state: "done",
  closedAt: "2026-10-02T09:00:00.000Z",
  parentId: null,
  subTodos: { done: 0, total: 0 },
  position: 1024,
  details: null,
  source: "dashboard",
  url: "http://x/personal?todo=01DONE",
  createdAt: "2026-10-01T08:00:00.000Z",
  updatedAt: "2026-10-02T09:00:00.000Z",
};
const req = (query = "") => new Request(`http://dash/api/todos/logbook${query}`);
const { GET } = await import("../app/api/todos/logbook/route");

beforeEach(() => fetchMock.mockReset());

describe("GET /api/todos/logbook", () => {
  it("reads one Logbook page, newest first, and passes the cursor on", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ items: [closed], nextCursor: "c2" }));
    const res = await GET(req("?cursor=c1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [closed], nextCursor: "c2" });
    const sent = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(sent.pathname).toBe("/v1/todos");
    expect(Object.fromEntries(sent.searchParams)).toEqual({ state: "closed", limit: "50", cursor: "c1" });
  });

  it("starts at the newest without a cursor", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ items: [], nextCursor: null }));
    expect(await (await GET(req())).json()).toEqual({ items: [], nextCursor: null });
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.has("cursor")).toBe(false);
  });

  it("maps an API failure to the standard error shape", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: "validation_error", message: "Bad cursor", details: {} } }, { status: 400 }));
    const res = await GET(req("?cursor=junk"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "validation_error", message: "Bad cursor" } });
  });
});
