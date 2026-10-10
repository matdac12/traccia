import { describe, expect, it } from "vitest";
import { parseTags, snippetOf } from "../lib/documentation";

describe("documentation helpers", () => {
  it("parses tags: trimmed, non-empty, de-duplicated, comma or newline separated", () => {
    expect(parseTags(" a, b ,,a\nc ")).toEqual(["a", "b", "c"]);
    expect(parseTags("")).toEqual([]);
  });

  it("makes a plain one-line snippet of markdown", () => {
    expect(snippetOf("# Title\n\n- one\n- **two**\n\n```js\ncode()\n```\nend")).toBe("Title one two end");
    expect(snippetOf("x".repeat(300), 20)).toHaveLength(20);
  });
});
