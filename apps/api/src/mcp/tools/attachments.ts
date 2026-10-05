import { Readable } from "node:stream";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ValidationError } from "../../service/errors.js";
import { createServices } from "../../service/index.js";
import {
  type AttachmentStorage,
  AttachmentValidationError,
  generateStorageKey,
  StorageNotFoundError,
  sanitizeFilename,
  storeUpload,
} from "../../storage/index.js";
import { sniffType } from "../../storage/validation.js";
import { runTool, toolResult } from "../errors.js";
import { explainPurgeDenied } from "./helpers.js";
import type { McpContext } from "../server.js";
import type { SourceFetcher } from "../ssrf-fetch.js";

/** Largest image `get_attachment` will inline as an image content block. */
export const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;

export type AttachmentToolDeps = {
  storage: AttachmentStorage;
  fetchSource: SourceFetcher;
};

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Picks the type to validate against: declared, else sniffed from the bytes, else the filename. */
function inferMimeType(head: Buffer, filename: string): string {
  const sniffed = sniffType(head);
  if (sniffed !== "text" && sniffed !== "binary") return sniffed;
  if (sniffed === "binary") return "application/octet-stream";
  if (/\.json$/i.test(filename)) return "application/json";
  if (/\.(md|markdown)$/i.test(filename)) return "text/markdown";
  return "text/plain";
}

const markdownFor = (mimeType: string, filename: string, url: string) => {
  const label = filename.replace(/[[\]\\]/g, "\\$&");
  return `${IMAGE_TYPES.has(mimeType) ? "!" : ""}[${label}](${url})`;
};

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Registers `create_attachment`, `get_attachment` and `delete_attachment`. */
export function registerAttachmentTools(
  server: McpServer,
  ctx: McpContext,
  deps: AttachmentToolDeps,
): void {
  const { container, actor } = ctx;
  const { config, db, logger } = container;
  const { storage, fetchSource } = deps;
  const { attachments, trash } = createServices({
    db,
    defaultIssueKey: config.defaultIssueKey,
    allowAgentPurge: config.allowAgentPurge,
    storage,
  });
  const urlFor = (id: string) =>
    `${config.baseUrl.replace(/\/+$/, "")}/files/${id}`;
  const run = (
    tool: string,
    fn: () => CallToolResult | Promise<CallToolResult>,
  ) => runTool(fn, (err) => logger.error("mcp tool failed", { tool, err }));

  server.registerTool(
    "create_attachment",
    {
      description:
        "Attach a file (typically a screenshot) to an issue or one of its comments. Provide exactly one of contentBase64 (max ~5 MB decoded) or sourceUrl (public HTTPS URL the server downloads). Returns a ready-to-paste markdown snippet.",
      inputSchema: {
        issueId: z
          .string()
          .min(1)
          .describe("Issue identifier (MAT-123) or id."),
        commentId: z
          .string()
          .optional()
          .describe("Attach to a specific comment instead of the issue."),
        filename: z.string().min(1).describe("e.g. login-bug.png"),
        mimeType: z
          .string()
          .optional()
          .describe(
            "Inferred from content if omitted; verified by content sniffing.",
          ),
        contentBase64: z.string().optional().describe("Max ~5 MB decoded."),
        sourceUrl: z
          .string()
          .optional()
          .describe("HTTPS URL the server will download (size-capped)."),
      },
    },
    (input) =>
      run("create_attachment", async () => {
        const hasB64 = input.contentBase64 !== undefined;
        const hasUrl = input.sourceUrl !== undefined;
        if (hasB64 === hasUrl) {
          throw new ValidationError(
            "Provide exactly one of contentBase64 or sourceUrl",
          );
        }
        // Reject an unknown issue before any bytes are decoded or fetched.
        attachments.resolveTarget(input.issueId);
        const filename = sanitizeFilename(input.filename);
        const storageKey = generateStorageKey();

        let source: Readable;
        let declared: string;
        let maxBytes: number;
        if (hasB64) {
          const b64 = input.contentBase64!.replace(/\s+/g, "");
          if ((b64.length * 3) / 4 - 2 > config.maxMcpUploadBytes) {
            throw new ValidationError(
              `contentBase64 exceeds the ${config.maxMcpUploadBytes} byte limit; use sourceUrl for larger files`,
            );
          }
          if (!BASE64.test(b64) || b64.length % 4 === 1) {
            throw new ValidationError("contentBase64 is not valid base64");
          }
          const bytes = Buffer.from(b64, "base64");
          declared =
            input.mimeType ?? inferMimeType(bytes.subarray(0, 512), filename);
          maxBytes = config.maxMcpUploadBytes;
          source = Readable.from([bytes]);
        } else {
          const fetched = await fetchSource(input.sourceUrl!, {
            maxBytes: config.maxAttachmentBytes,
          });
          source = fetched.stream;
          declared = input.mimeType ?? fetched.contentType;
          maxBytes = config.maxAttachmentBytes;
        }

        try {
          const stored = await storeUpload(storage, storageKey, source, {
            declaredMimeType: declared,
            maxBytes,
          });
          try {
            const created = attachments.create(actor, input.issueId, {
              commentId: input.commentId,
              filename,
              mimeType: stored.mimeType,
              sizeBytes: stored.sizeBytes,
              sha256: stored.sha256,
              storageKey,
            });
            const url = urlFor(created.id);
            return toolResult({
              id: created.id,
              filename: created.filename,
              mimeType: created.mimeType,
              sizeBytes: created.sizeBytes,
              url,
              markdown: markdownFor(created.mimeType, created.filename, url),
            });
          } catch (err) {
            await storage.delete(storageKey).catch(() => {});
            throw err;
          }
        } catch (err) {
          source.destroy();
          if (err instanceof AttachmentValidationError) {
            const hint =
              err.code === "unsupported_type" && hasUrl && !input.mimeType
                ? " (the URL's Content-Type is not an allowed type; pass mimeType if you know the real one)"
                : "";
            throw new ValidationError(`${err.message}${hint}`, {
              reason: err.code,
            });
          }
          throw err;
        }
      }),
  );

  server.registerTool(
    "get_attachment",
    {
      description:
        "Get an attachment's metadata. Images under 2 MB are also returned inline unless includeContent is false.",
      inputSchema: {
        id: z.string().min(1).describe("Attachment id."),
        includeContent: z
          .boolean()
          .default(true)
          .optional()
          .describe("Default true; inline the image if it is under 2 MB."),
      },
    },
    ({ id, includeContent }) =>
      run("get_attachment", async () => {
        const record = attachments.getRecord(id);
        const meta = {
          id: record.id,
          issueId: record.issueId,
          commentId: record.commentId,
          filename: record.filename,
          mimeType: record.mimeType,
          sizeBytes: record.sizeBytes,
          url: urlFor(record.id),
          createdAt: record.createdAt,
        };
        const result = toolResult(meta);
        if (
          includeContent !== false &&
          IMAGE_TYPES.has(record.mimeType) &&
          record.sizeBytes <= MAX_INLINE_IMAGE_BYTES
        ) {
          try {
            const { stream } = await storage.get(record.storageKey);
            const data = await readAll(stream);
            result.content.push({
              type: "image",
              data: data.toString("base64"),
              mimeType: record.mimeType,
            });
          } catch (err) {
            if (!(err instanceof StorageNotFoundError)) throw err;
            throw new ValidationError(
              "Attachment file is missing from storage",
            );
          }
        }
        return result;
      }),
  );

  server.registerTool(
    "delete_attachment",
    {
      description:
        "Soft-deletes an attachment (restorable). purge=true permanently removes an ALREADY deleted attachment and its file; only allowed for actor 'you' (or agents when ALLOW_AGENT_PURGE is on).",
      inputSchema: {
        id: z.string().min(1).describe("Attachment id."),
        purge: z.boolean().default(false).optional().describe("Default false."),
      },
    },
    ({ id, purge }) =>
      run("delete_attachment", async () => {
        if (purge === true) {
          // Permission, the two-step rule and file removal live in trash.purge.
          const result = await trash
            .purge(actor, "attachment", id)
            .catch(explainPurgeDenied);
          for (const storageKey of result.failedFiles) {
            logger.error("purged attachment file not removed", {
              attachmentId: id,
              storageKey,
            });
          }
          return toolResult({ id, deleted: true, purged: true });
        }
        await trash.delete(actor, "attachment", id);
        return toolResult({ id, deleted: true, purged: false });
      }),
  );
}
