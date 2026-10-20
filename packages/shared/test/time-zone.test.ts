import { describe, expect, it } from "vitest";
import { canonicalTimeZone, isTimeZone } from "../src/time-zone.js";

describe("canonicalTimeZone", () => {
  it("returns the canonical IANA name", () => {
    expect(canonicalTimeZone("Europe/Rome")).toBe("Europe/Rome");
    expect(canonicalTimeZone("europe/rome")).toBe("Europe/Rome");
    expect(canonicalTimeZone("UTC")).toBe("UTC");
  });

  it("rejects unknown zones and bare UTC offsets", () => {
    expect(canonicalTimeZone("Mars/Base")).toBeUndefined();
    expect(canonicalTimeZone("+01:00")).toBeUndefined();
    expect(canonicalTimeZone("-05:00")).toBeUndefined();
    expect(canonicalTimeZone("")).toBeUndefined();
  });
});

describe("isTimeZone", () => {
  it("accepts IANA zones and refuses the rest", () => {
    expect(isTimeZone("Europe/Rome")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    // A bare offset is not a zone.
    expect(isTimeZone("+01:00")).toBe(false);
    expect(isTimeZone("")).toBe(false);
  });
});
