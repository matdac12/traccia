import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createTestDb } from "../test/helpers/test-db.js";

/** What a successful call returns. Tools declare no output schema, so this is written by hand. */
export const RETURNS: Record<string, string> = {
  whoami: "`{ actor, tokenName }`",
  list_issues:
    "`{ items, nextCursor? }`. Each item is a compact issue: `identifier`, `title`, `status`, `priority`, `assignee`, `labels`, `project`, `milestone`, `parent`, `estimate`, `updatedAt`, `descriptionSnippet`, `deleted`. Empty fields are omitted.",
  get_issue:
    "A compact issue with the full `description` (no snippet), plus `createdBy`, `createdAt`, `startedAt`, `completedAt`, `canceledAt` and the requested `include` sections: `comments`, `attachments`, `children`, `relations` (`{ blockedBy, blocks, related }`, each `{ identifier, title, status }`), `activity`.",
  save_issue:
    "The saved compact issue, plus `relations` when `blockedBy`, `blocks` or `related` was given.",
  delete_issue:
    "Soft delete: `{ type, id, batch, counts }`. Purge: `{ type, id, counts, failedFiles }`.",
  list_comments:
    "`{ items, nextCursor }`. Each comment: `id`, `body`, `actor`, `parentId`, `createdAt`, `updatedAt`, `attachments`, `deleted`.",
  save_comment: "The saved comment (same shape as in `list_comments`).",
  delete_comment:
    "Soft delete: `{ type, id, batch, counts }`. Purge: `{ type, id, counts, failedFiles }`.",
  create_attachment:
    "`{ id, filename, mimeType, sizeBytes, url, markdown }`. Paste `markdown` into a comment or description.",
  get_attachment:
    "Metadata `{ id, filename, mimeType, sizeBytes, commentId, createdAt }`, plus the image itself as image content when `includeContent` is true and the file is an image under 2 MB.",
  delete_attachment: "`{ id, deleted: true, purged }`.",
  list_projects:
    "`{ items, nextCursor? }`. Each project: `id`, `key`, `name`, `status`, `issueCounts` (per status), `deleted`.",
  get_project:
    "A project (as in `list_projects`) plus `description`, `createdAt`, `updatedAt` and `milestones` with progress.",
  save_project:
    "The saved project: `id`, `key`, `name`, `status`, `description`.",
  delete_project:
    "Soft delete: `{ type, id, batch, counts }`. Purge: `{ type, id, counts, failedFiles }`.",
  list_milestones:
    "`{ items }`. Each milestone: `id`, `project` (name), `name`, `targetDate`, `progress` (`{ done, total }`), `deleted`.",
  save_milestone:
    "The saved milestone (as in `list_milestones`, with `description`).",
  delete_milestone:
    "Soft delete: `{ type, id, batch, counts }`. Purge: `{ type, id, counts, failedFiles }`.",
  list_issue_labels:
    "`{ items }`. Each label: `id`, `name`, `color`, `project` (name, absent for global labels).",
  save_issue_label: "The saved label (as in `list_issue_labels`).",
  restore:
    "`{ type, id, batch, counts }`: everything deleted in the same action comes back.",
};

export const DOC_COMMAND = "pnpm docs:tools";

/** Lists the tools exactly as an agent sees them, from a server over an empty in-memory database. */
export async function listTools(): Promise<Tool[]> {
  const config = loadConfig({ BASE_URL: "http://localhost:8787" });
  const { db } = createTestDb();
  const logger = createLogger(config.logLevel, () => {});
  const server = createMcpServer(
    { container: { config, db, logger }, actor: "agent", tokenName: "docs" },
    { attachments: {} as never },
  );
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "docs", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
  }
}

type Schema = {
  type?: string;
  enum?: unknown[];
  anyOf?: Schema[];
  items?: Schema;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
};

function typeOf(s: Schema): string {
  if (s.enum) return s.enum.map((v) => `\`${String(v)}\``).join(" \\| ");
  if (s.anyOf) return [...new Set(s.anyOf.map(typeOf))].join(" \\| ");
  if (s.type === "array") return `${s.items ? typeOf(s.items) : "any"}[]`;
  return s.type ?? "any";
}

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

function describeArgs(tool: Tool): string {
  const schema = tool.inputSchema as Schema;
  const props = Object.entries(schema.properties ?? {});
  if (props.length === 0) return "No arguments.\n";
  const required = new Set(schema.required);
  const rows = props.map(([name, s]) => {
    const desc =
      s.description ?? s.anyOf?.find((a) => a.description)?.description;
    return `| \`${name}\` | ${typeOf(s)} | ${required.has(name) ? "yes" : "no"} | ${cell(desc ?? "")} |`;
  });
  return [
    "| Argument | Type | Required | Description |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

export function renderToolDocs(tools: Tool[]): string {
  const names = tools.map((t) => t.name);
  const missing = names.filter((n) => !(n in RETURNS));
  const extra = Object.keys(RETURNS).filter((n) => !names.includes(n));
  if (missing.length || extra.length) {
    throw new Error(
      `RETURNS in apps/api/scripts/mcp-tools-doc.ts is out of sync with the tools. Missing: ${missing.join(", ") || "none"}. Unknown: ${extra.join(", ") || "none"}.`,
    );
  }
  const lines = [
    "# MCP tools",
    "",
    `<!-- Generated by \`${DOC_COMMAND}\` from the tool definitions. Do not edit by hand. -->`,
    "",
    `Traccia exposes ${tools.length} tools over MCP. Every tool call is attributed to the actor of the token that made it; the actor is never a tool argument. See [agent-setup.md](agent-setup.md) to connect and [agent-snippet.md](agent-snippet.md) for the workflow agents should follow.`,
    "",
    "Failures come back as an `isError` result with a message you can act on. Successful results are compact JSON (text content plus identical `structuredContent`); null, empty and empty-array fields are omitted.",
    "",
    "## Index",
    "",
    ...tools.map((t) => `- [\`${t.name}\`](#${t.name})`),
    "",
  ];
  for (const tool of tools) {
    lines.push(
      `## ${tool.name}`,
      "",
      tool.description ?? "",
      "",
      describeArgs(tool),
      `**Returns:** ${RETURNS[tool.name]}`,
      "",
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function generateToolDocs(): Promise<string> {
  return renderToolDocs(await listTools());
}
