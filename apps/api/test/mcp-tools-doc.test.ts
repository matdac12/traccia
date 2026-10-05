import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { DOC_COMMAND, generateToolDocs } from "../scripts/mcp-tools-doc.js";

const DOC = fileURLToPath(
  new URL("../../../docs/mcp-tools.md", import.meta.url),
);

it("docs/mcp-tools.md matches the tool definitions", async () => {
  const expected = await generateToolDocs();
  const actual = readFileSync(DOC, "utf8");
  if (actual !== expected) {
    throw new Error(
      `docs/mcp-tools.md is stale: the MCP tool definitions changed. Run \`${DOC_COMMAND}\` from the repo root and commit the result.`,
    );
  }
});

it("documents every tool with its arguments", async () => {
  const doc = await generateToolDocs();
  expect(doc).toContain("## save_issue");
  expect(doc).toContain("| `title` |");
});
