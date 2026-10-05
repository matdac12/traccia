import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateToolDocs } from "./mcp-tools-doc.js";

const TOOLS_DOC_PATH = fileURLToPath(
  new URL("../../../docs/mcp-tools.md", import.meta.url),
);

writeFileSync(TOOLS_DOC_PATH, await generateToolDocs());
console.log(`wrote ${TOOLS_DOC_PATH}`);
