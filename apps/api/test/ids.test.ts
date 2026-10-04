import { describe, expect, it } from "vitest";
import { newId } from "../src/ids.js";
import { nowIso } from "../src/time.js";

describe("newId", () => {
  it("returns 26-char ULIDs that sort in creation order", () => {
    const a = newId();
    const b = newId();
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a < b).toBe(true);
  });
});

describe("nowIso", () => {
  it("returns ISO 8601 UTC with milliseconds", () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
