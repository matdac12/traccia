import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../lib/api/client";

const fetchMock = vi.fn();
vi.mock("../lib/api/client", async (orig) => {
  const mod = await orig<typeof import("../lib/api/client")>();
  const client = mod.createApiClient({ baseUrl: "http://api", token: "trk_secret_token", fetch: ((...a: unknown[]) => fetchMock(...a)) as never });
  return { ...mod, api: () => client };
});

const ID = "01J9ZZZZZZZZZZZZZZZZZZZZZZ";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method = "GET") => new Request(`http://dash/api/files/${ID}`, { method });
beforeEach(() => {
  fetchMock.mockReset();
  void createApiClient;
});

describe("GET /api/files/[id]", () => {
  it("streams the file with the server-side token and passes the headers through", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("PDFDATA", {
        headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="a.pdf"', "content-length": "7", "x-content-type-options": "nosniff", "set-cookie": "x=1" },
      }),
    );
    const { GET } = await import("../app/api/files/[id]/route");
    const res = await GET(req(), ctx(ID));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("PDFDATA");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="a.pdf"');
    expect(res.headers.get("content-length")).toBe("7");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("set-cookie")).toBeNull();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`http://api/v1/files/${ID}`);
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer trk_secret_token" });
  });

  it("forces nosniff even if the API omitted it, and never leaks the token", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { headers: { "content-type": "text/plain" } }));
    const { GET } = await import("../app/api/files/[id]/route");
    const res = await GET(req(), ctx(ID));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(JSON.stringify([...res.headers])).not.toContain("trk_secret_token");
  });

  it("answers HEAD without a body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { headers: { "content-type": "image/png", "content-length": "9" } }));
    const { HEAD } = await import("../app/api/files/[id]/route");
    const res = await HEAD(req("HEAD"), ctx(ID));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("9");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "HEAD" });
  });

  it("maps an unknown attachment to 404 in the standard error shape", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: "not_found", message: "x" } }, { status: 404 }));
    const { GET } = await import("../app/api/files/[id]/route");
    const res = await GET(req(), ctx(ID));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it("rejects ids that are not ULIDs without calling the API", async () => {
    const { GET } = await import("../app/api/files/[id]/route");
    const res = await GET(req(), ctx("../../v1/tokens"));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when the API is down or fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { GET } = await import("../app/api/files/[id]/route");
    expect((await GET(req(), ctx(ID))).status).toBe(502);
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    expect((await GET(req(), ctx(ID))).status).toBe(502);
  });
});

describe("proxy.ts covers the file routes", () => {
  it("returns 403 JSON for /api/files/* without the identity header", async () => {
    vi.stubEnv("DASHBOARD_ALLOWED_LOGINS", "you@local");
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("../proxy");
    const res = proxy(new NextRequest(`http://dash/api/files/${ID}`));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "forbidden" } });
    const ok = proxy(new NextRequest(`http://dash/api/files/${ID}`, { headers: { "tailscale-user-login": "you@local" } }));
    expect(ok.status).toBe(200);
    vi.unstubAllEnvs();
  });
});

describe("POST /api/issues/[identifier]/attachments", () => {
  const post = (identifier: string, headers: Record<string, string>, body?: BodyInit) =>
    import("../app/api/issues/[identifier]/attachments/route").then(({ POST }) =>
      POST(new Request("http://dash/x", { method: "POST", headers, body }), { params: Promise.resolve({ identifier }) }),
    );

  it("forwards the multipart body and returns the API's error shape unchanged", async () => {
    const form = new FormData();
    form.append("file", new Blob(["hi"], { type: "text/plain" }), "a.txt");
    const probe = new Request("http://dash/x", { method: "POST", body: form });
    const err = { error: { code: "validation_error", message: "Unsupported file type: application/zip", details: { reason: "unsupported_type" } } };
    fetchMock.mockResolvedValueOnce(Response.json(err, { status: 400 }));
    const res = await post("PIL-1", { "content-type": probe.headers.get("content-type")! }, await probe.arrayBuffer());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(err);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://api/v1/issues/PIL-1/attachments");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer trk_secret_token", "content-type": probe.headers.get("content-type") });
  });

  it("rejects a non-multipart body and bad identifiers before calling the API", async () => {
    expect((await post("PIL-1", { "content-type": "application/json" }, "{}")).status).toBe(400);
    expect((await post("a/b", { "content-type": "multipart/form-data; boundary=x" }, "x")).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
