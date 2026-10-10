import type { Readable } from "node:stream";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpPaginationShape } from "@traccia/shared";
import { z } from "zod";
import { DOCUMENT_MAX_BYTES, type Document } from "../../service/documents.js";
import { ValidationError } from "../../service/errors.js";
import { createServices } from "../../service/index.js";
import { StorageNotFoundError } from "../../storage/index.js";
import type { McpContext } from "../server.js";
import {
  type AttachmentToolDeps,
  decodeBase64Upload,
  inferMimeType,
  markdownFor,
  readAll,
} from "./attachments.js";
import { defineTool, explainPurgeDenied } from "./helpers.js";
import { compactObject } from "./present.js";

/** Types `get_document` returns as text (ADR 0014); everything else is metadata + URL. */
const INLINE_TEXT_TYPES = new Set([
  "text/markdown",
  "text/plain",
  "application/json",
]);

const projectRef = z.string().min(1).describe("Project key, name or id.");

const DELETE_NOTE =
  "Soft-delete a document (restorable via restore). purge=true permanently removes an already-deleted document and its file; agents may purge documents.";

export function registerDocumentTools(
  server: McpServer,
  ctx: McpContext,
  deps: AttachmentToolDeps,
) {
  const { config } = ctx.container;
  const { documents, trash } = createServices({
    db: ctx.container.db,
    defaultIssueKey: config.defaultIssueKey,
    allowAgentPurge: config.allowAgentPurge,
    storage: deps.storage,
  });
  const urlFor = (id: string) =>
    `${config.baseUrl.replace(/\/+$/, "")}/files/${id}`;
  const present = (d: Document) =>
    compactObject({
      id: d.id,
      projectId: d.projectId,
      filename: d.filename,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      description: d.description,
      url: urlFor(d.id),
      createdBy: d.createdBy,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      deleted: d.deletedAt ? true : undefined,
    });

  defineTool(
    server,
    ctx,
    "list_documents",
    "List a project's documents (files), most recently updated first. Metadata only; use get_document for content.",
    {
      project: projectRef,
      query: z.string().optional().describe("Match filename or description."),
      includeDeleted: z.boolean().optional(),
      ...mcpPaginationShape,
    },
    ({ project, ...q }) => {
      const page = documents.list(project, q);
      return { items: page.items.map(present), nextCursor: page.nextCursor };
    },
  );

  defineTool(
    server,
    ctx,
    "get_document",
    "Get a document's metadata. text/markdown, text/plain and application/json are also returned inline as content; other types only get the url (fetched with the API token).",
    { id: z.string().min(1).describe("Document id.") },
    async ({ id }) => {
      const record = documents.getRecord(id);
      const meta = present(documents.get(id));
      if (!INLINE_TEXT_TYPES.has(record.mimeType)) return meta;
      try {
        const { stream } = await deps.storage.get(record.storageKey);
        const content = (await readAll(stream)).toString("utf8");
        return { ...meta, content };
      } catch (err) {
        if (!(err instanceof StorageNotFoundError)) throw err;
        throw new ValidationError("Document file is missing from storage");
      }
    },
  );

  defineTool(
    server,
    ctx,
    "create_document",
    "Add a file to a project's Files. Give exactly one of content (text), contentBase64 (max ~5 MB decoded) or sourceUrl (public HTTPS, downloaded by the server). Types: text/markdown, text/plain, application/json, PDF, PNG, JPEG, WebP, GIF. Returns a markdown snippet to paste into an issue.",
    {
      project: projectRef,
      filename: z.string().min(1),
      description: z.string().optional().describe("Max 2000 chars."),
      mimeType: z.string().optional().describe("Inferred if omitted."),
      content: z.string().optional().describe("UTF-8 text of the file."),
      contentBase64: z.string().optional(),
      sourceUrl: z.string().optional(),
    },
    async (input) => {
      const given = [input.content, input.contentBase64, input.sourceUrl];
      if (given.filter((v) => v !== undefined).length !== 1) {
        throw new ValidationError(
          "Provide exactly one of content, contentBase64 or sourceUrl",
        );
      }
      let bytes: Buffer | Readable;
      let declared = input.mimeType;
      if (input.sourceUrl !== undefined) {
        const fetched = await deps.fetchSource(input.sourceUrl, {
          maxBytes: DOCUMENT_MAX_BYTES,
        });
        bytes = fetched.stream;
        declared ??= fetched.contentType;
      } else {
        const buf =
          input.content !== undefined
            ? Buffer.from(input.content, "utf8")
            : decodeBase64Upload(
                input.contentBase64!,
                config.maxMcpUploadBytes,
              );
        bytes = buf;
        declared ??= inferMimeType(buf.subarray(0, 512), input.filename);
      }
      const doc = await documents.create(ctx.actor, input.project, {
        filename: input.filename,
        mimeType: declared as string,
        description: input.description,
        content: bytes,
      });
      const url = urlFor(doc.id);
      return {
        ...present(doc),
        markdown: markdownFor(doc.mimeType, doc.filename, url),
      };
    },
  );

  defineTool(
    server,
    ctx,
    "update_document",
    "Rename and/or re-describe a document (the bytes never change). expectedUpdatedAt fails on concurrent edits.",
    {
      id: z.string().min(1).describe("Document id."),
      filename: z.string().optional(),
      description: z.string().optional().describe("Max 2000 chars."),
      expectedUpdatedAt: z.string().optional(),
    },
    ({ id, ...patch }) => present(documents.update(id, patch)),
  );

  defineTool(
    server,
    ctx,
    "delete_document",
    DELETE_NOTE,
    {
      id: z.string().min(1).describe("Document id."),
      purge: z.boolean().optional(),
    },
    async ({ id, purge }) => {
      try {
        return {
          ...(await trash.delete(ctx.actor, "document", id, { purge })),
        };
      } catch (err) {
        if (purge) explainPurgeDenied(err);
        throw err;
      }
    },
  );
}
