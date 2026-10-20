import { afterEach, describe, expect, it, vi } from "vitest";
import { getJson, getTaggedJson } from "../lib/polling/fetch-json";

afterEach(() => vi.unstubAllGlobals());

describe("getJson", () => {
  const stub = () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ n: 1 })));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("never stores the answer by default", async () => {
    const fetchMock = stub();
    expect(await getJson("/api/x")).toEqual({ n: 1 });
    expect(fetchMock).toHaveBeenCalledWith("/api/x", expect.objectContaining({ cache: "no-store" }));
  });

  it("revalidates instead when asked, so the browser sends If-None-Match", async () => {
    const fetchMock = stub();
    await getTaggedJson("/api/x");
    expect(fetchMock).toHaveBeenCalledWith("/api/x", expect.objectContaining({ cache: "no-cache" }));
  });

  it("throws on a non-2xx answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    await expect(getJson("/api/x")).rejects.toThrow("/api/x answered 500");
  });
});
