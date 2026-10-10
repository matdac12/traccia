import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../lib/api/client";

const fetchMock = vi.fn();
vi.mock("../lib/api/client", async (orig) => {
  const mod = await orig<typeof import("../lib/api/client")>();
  const client = mod.createApiClient({ baseUrl: "http://api", token: "trk_secret_token", fetch: ((...a: unknown[]) => fetchMock(...a)) as never });
  return { ...mod, api: () => client };
});

const ID = "01J9ZZZZZZZZZZZZZZZZZZZZZZ";
beforeEach(() => {
  fetchMock.mockReset();
  void createApiClient;
});

describe("GET /api/files/doc/[id]", () => {
  it("streams the document from the API's /files/doc path (outside /v1) with the server-side token", async () => {
    fetchMock.mockResolvedValueOnce(new Response("PDFDATA", { headers: { "content-type": "application/pdf", "content-length": "7", "set-cookie": "x=1" } }));
    const { GET } = await import("../app/api/files/doc/[id]/route");
    const res = await GET(new Request(`http://dash/api/files/doc/${ID}`), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("PDFDATA");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("set-cookie")).toBeNull();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`http://api/files/doc/${ID}`);
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer trk_secret_token" });
  });

  it("sandboxes non-PDF files and answers 404 for a bad id without calling the API", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { headers: { "content-type": "text/plain" } }));
    const { GET } = await import("../app/api/files/doc/[id]/route");
    const ok = await GET(new Request("http://dash/x"), { params: Promise.resolve({ id: ID }) });
    expect(ok.headers.get("content-security-policy")).toContain("sandbox");
    fetchMock.mockClear();
    const bad = await GET(new Request("http://dash/x"), { params: Promise.resolve({ id: "../x" }) });
    expect(bad.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps an upstream 404 to 404 and other failures to 502", async () => {
    const { GET } = await import("../app/api/files/doc/[id]/route");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    expect((await GET(new Request("http://dash/x"), { params: Promise.resolve({ id: ID }) })).status).toBe(404);
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    expect((await GET(new Request("http://dash/x"), { params: Promise.resolve({ id: ID }) })).status).toBe(502);
  });
});

describe("POST /api/projects/[id]/documents", () => {
  const ctx = { params: Promise.resolve({ id: "p1" }) };
  const upload = () => {
    const form = new FormData();
    form.append("file", new File(["hi"], "a.txt", { type: "text/plain" }));
    form.append("description", "d");
    return new Request("http://dash/api/projects/p1/documents", { method: "POST", body: form });
  };

  it("forwards the multipart body to /v1/projects/:id/documents and passes the JSON answer through", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: ID }), { status: 201, headers: { "content-type": "application/json" } }));
    const { POST } = await import("../app/api/projects/[id]/documents/route");
    const res = await POST(upload(), ctx);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: ID });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://api/v1/projects/p1/documents");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer trk_secret_token" });
  });

  it("rejects a non-multipart body and a bad project reference before calling the API", async () => {
    const { POST } = await import("../app/api/projects/[id]/documents/route");
    const json = new Request("http://dash/x", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect((await POST(json, ctx)).status).toBe(400);
    expect((await POST(upload(), { params: Promise.resolve({ id: "a/b" }) })).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the API's validation error through and hides a server failure", async () => {
    const { POST } = await import("../app/api/projects/[id]/documents/route");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "validation_error", message: "bad type" } }), { status: 400, headers: { "content-type": "application/json" } }));
    const res = await POST(upload(), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("bad type");
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 500, headers: { "content-type": "text/plain" } }));
    expect((await POST(upload(), ctx)).status).toBe(502);
  });
});
