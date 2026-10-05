import path from "node:path";
import { Readable } from "node:stream";
import Busboy from "busboy";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { canPurge } from "../auth/permissions.js";
import { createServices } from "../service/index.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../service/errors.js";
import {
  type AttachmentStorage,
  AttachmentValidationError,
  LocalDiskStorage,
  StorageNotFoundError,
  contentDisposition,
  generateStorageKey,
  sanitizeFilename,
  storeUpload,
} from "../storage/index.js";
import type { AppContainer, AppEnv } from "./env.js";
import { validateQuery } from "./validate.js";

const deleteQuerySchema = z.object({
  purge: z.enum(["true", "false"]).optional(),
});

/** Errors raised by busboy or the request stream, as opposed to storage I/O. */
const isFormError = (err: unknown) =>
  (err instanceof Error &&
    /^(Unexpected end of form|Malformed|Multipart|Missing|Unsupported|Part terminated|Boundary)/i.test(
      err.message,
    )) ||
  (err as { code?: string })?.code === "ERR_STREAM_PREMATURE_CLOSE";

/** Parsed multipart form: at most one file plus the optional `comment_id` field. */
type Upload = {
  storageKey: string;
  filename: string;
  result: Awaited<ReturnType<typeof storeUpload>>;
  commentId: string | undefined;
};

/**
 * Streams the single file part of a multipart request into storage while
 * validating it. On any failure the stored object (if any) is removed.
 */
async function receiveUpload(
  req: Request,
  storage: AttachmentStorage,
  maxBytes: number,
): Promise<Upload> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data/i.test(contentType) || !req.body) {
    throw new ValidationError("Expected a multipart/form-data body");
  }

  let busboy: Busboy.Busboy;
  try {
    busboy = Busboy({
      headers: { "content-type": contentType },
      defParamCharset: "utf8",
      limits: { files: 1, fields: 10, parts: 12 },
    });
  } catch {
    throw new ValidationError("Malformed multipart/form-data request");
  }

  const storageKey = generateStorageKey();
  let upload: Promise<Upload["result"]> | undefined;
  let filename = "";
  let commentId: string | undefined;
  let extraFile = false;

  const source = Readable.fromWeb(req.body as never);
  const parsed = new Promise<void>((resolve, reject) => {
    busboy.on("field", (name, value) => {
      if (name === "comment_id" && value !== "") commentId = value;
    });
    busboy.on("file", (_name, file, info) => {
      if (upload) {
        extraFile = true;
        file.resume();
        return;
      }
      filename = sanitizeFilename(info.filename);
      upload = storeUpload(storage, storageKey, file, {
        declaredMimeType: info.mimeType,
        maxBytes,
      });
      // A rejected file ends the request early; busboy would otherwise never close.
      upload.catch(reject);
    });
    busboy.on("filesLimit", () => {
      extraFile = true;
    });
    busboy.on("error", reject);
    busboy.on("close", resolve);
    source.on("error", reject);
    source.pipe(busboy);
  });

  try {
    try {
      await parsed;
    } catch (err) {
      if (err instanceof AttachmentValidationError) throw err;
      // Storage failures are ours (500); only a broken form is the client's.
      if (isFormError(err)) {
        throw new ValidationError("Malformed multipart/form-data request");
      }
      throw err;
    }
    const result = await upload;
    if (!result) {
      throw new ValidationError('Missing file part in field "file"');
    }
    if (extraFile) {
      throw new ValidationError("Only one file may be uploaded per request");
    }
    return { storageKey, filename, result, commentId };
  } catch (err) {
    source.unpipe(busboy);
    source.destroy();
    await storage.delete(storageKey).catch(() => {});
    if (err instanceof AttachmentValidationError) {
      throw new ValidationError(err.message, { reason: err.code });
    }
    throw err;
  }
}

/**
 * Attachment routes. `v1` gets the JSON API; `/files/:id` is mounted on `app`
 * behind the same auth middleware (downloads are never public).
 */
export function mountAttachmentRoutes(
  app: Hono<AppEnv>,
  v1: Hono<AppEnv>,
  container: AppContainer,
  auth: MiddlewareHandler<AppEnv>,
  storage: AttachmentStorage = new LocalDiskStorage(
    path.join(container.config.dataDir, "attachments"),
  ),
) {
  const { config, db } = container;
  const { attachments } = createServices({
    db,
    defaultIssueKey: config.defaultIssueKey,
  });
  const withUrl = <T extends { id: string }>(a: T) => ({
    ...a,
    url: `${config.baseUrl.replace(/\/+$/, "")}/files/${a.id}`,
  });

  v1.post("/issues/:identifier/attachments", async (c) => {
    const actor = c.get("actor");
    const issueRef = c.req.param("identifier");
    // Reject an unknown issue before any bytes are read.
    attachments.resolveTarget(issueRef);
    const upload = await receiveUpload(
      c.req.raw,
      storage,
      config.maxAttachmentBytes,
    );
    try {
      const created = attachments.create(actor, issueRef, {
        commentId: upload.commentId,
        filename: upload.filename,
        mimeType: upload.result.mimeType,
        sizeBytes: upload.result.sizeBytes,
        sha256: upload.result.sha256,
        storageKey: upload.storageKey,
      });
      return c.json(withUrl(created), 201);
    } catch (err) {
      // e.g. the comment belongs to another issue: nothing may stay on disk.
      await storage.delete(upload.storageKey).catch(() => {});
      throw err;
    }
  });

  v1.get("/attachments/:id", (c) =>
    c.json(withUrl(attachments.get(c.req.param("id")))),
  );

  v1.delete("/attachments/:id", async (c) => {
    const id = c.req.param("id");
    const { purge } = validateQuery(c, deleteQuerySchema);
    if (purge === "true") {
      if (!canPurge(c.get("actor"), config)) {
        throw new ForbiddenError("This token may not purge attachments");
      }
      const record = attachments.purge(id);
      await storage.delete(record.storageKey).catch((err) => {
        c.get("logger").error("purged attachment file not removed", {
          attachmentId: id,
          storageKey: record.storageKey,
          error: String(err),
        });
      });
      return c.json({ id, deleted: true, purged: true });
    }
    attachments.softDelete(c.get("actor"), id);
    return c.json({ id, deleted: true, purged: false });
  });

  const download = async (c: Context<AppEnv>) => {
    const record = attachments.getRecord(c.req.param("id") ?? "");
    const headers: Record<string, string> = {
      "Content-Type": record.mimeType,
      "Content-Disposition": contentDisposition(
        record.mimeType,
        record.filename,
      ),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
    };
    try {
      const { stream, size } = await storage.get(record.storageKey);
      if (c.req.method === "HEAD") {
        stream.destroy();
        return new Response(null, {
          headers: { ...headers, "Content-Length": String(size) },
        });
      }
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        headers: { ...headers, "Content-Length": String(size) },
      });
    } catch (err) {
      if (err instanceof StorageNotFoundError) {
        throw new NotFoundError("Attachment file is missing");
      }
      throw err;
    }
  };

  v1.get("/files/:id", download);
  const files = new Hono<AppEnv>();
  files.use(auth);
  files.get("/:id", download);
  app.route("/files", files);
}
