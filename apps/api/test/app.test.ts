import { SHARED_PLACEHOLDER } from "@linear-matti/shared";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";

describe("GET /healthz", () => {
  it("returns { ok: true }", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("workspace wiring", () => {
  it("imports from @linear-matti/shared", () => {
    expect(SHARED_PLACEHOLDER).toBe("shared-ok");
  });
});
