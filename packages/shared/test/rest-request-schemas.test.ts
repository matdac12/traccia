import { describe, expect, it } from "vitest";
import {
  listLabelsRequestQuerySchema,
  searchParamsRecord,
} from "../src/index.js";

describe("searchParamsRecord", () => {
  it("keeps a single key a string and a repeated key an array", () => {
    expect({
      ...searchParamsRecord(new URLSearchParams("a=1&b=2&b=3")),
    }).toEqual({ a: "1", b: ["2", "3"] });
  });

  it("treats ?__proto__= as an ordinary key, not the prototype", () => {
    const raw = searchParamsRecord(new URLSearchParams("__proto__=x&limit=5"));
    expect(Object.getPrototypeOf(raw)).toBeNull();
    expect(Object.keys(raw)).toEqual(["__proto__", "limit"]);
    expect(Object.entries(raw)).toContainEqual(["__proto__", "x"]);
    expect(listLabelsRequestQuerySchema.parse(raw)).toEqual({ limit: 5 });
  });

  it("collects a repeated ?__proto__ into an array", () => {
    const raw = searchParamsRecord(
      new URLSearchParams("__proto__=a&__proto__=b"),
    );
    expect(Object.entries(raw)).toEqual([["__proto__", ["a", "b"]]]);
  });
});
