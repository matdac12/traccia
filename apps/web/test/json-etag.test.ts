import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { jsonWithEtag } = await import("../lib/api/json-etag");

const get = (headers: Record<string, string> = {}) => new Request("http://dash/api/todos", { headers });

describe("jsonWithEtag", () => {
  it("answers the JSON with a strong ETag and no-cache", async () => {
    const res = jsonWithEtag(get(), { a: 1 });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("etag")).toMatch(/^"[\w-]+"$/);
    expect(await res.json()).toEqual({ a: 1 });
  });

  it("answers 304 with no body when If-None-Match has the tag, and 200 once the data changes", async () => {
    const etag = jsonWithEtag(get(), { a: 1 }).headers.get("etag")!;
    const same = jsonWithEtag(get({ "if-none-match": etag }), { a: 1 });
    expect(same.status).toBe(304);
    expect(same.headers.get("etag")).toBe(etag);
    expect(await same.text()).toBe("");
    const changed = jsonWithEtag(get({ "if-none-match": etag }), { a: 2 });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
  });

  it("matches a tag in a list or with a weak prefix, and ignores one that is not ours", () => {
    const etag = jsonWithEtag(get(), { a: 1 }).headers.get("etag")!;
    expect(jsonWithEtag(get({ "if-none-match": `"x", W/${etag}` }), { a: 1 }).status).toBe(304);
    expect(jsonWithEtag(get({ "if-none-match": '"x"' }), { a: 1 }).status).toBe(200);
    expect(jsonWithEtag(get({ "if-none-match": "*" }), { a: 1 }).status).toBe(304);
  });
});
