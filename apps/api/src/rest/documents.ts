import { Readable } from "node:stream";
import { purgeQuerySchema } from "@traccia/shared";
import Busboy from "busboy";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { DOCUMENT_MAX_BYTES } from "../service/documents.js";
import { NotFoundError, ValidationError } from "../service/errors.js";
import { contentDisposition, StorageNotFoundError } from "../storage/index.js";
import type { AppContainer, AppEnv } from "./env.js";
import { fileStorageFor, servicesFor } from "./services.js";
import { ifMatch, validateBody, validateQuery } from "./validate.js";

const listQuery = z.object({
  query: z.string().min(1).optional(),
  includeDeleted: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).optional(),
  cursor: z.string().min(1).optional(),
});

const updateBody = z.object({
  filename: z.string().optional(),
  description: z.string().optional(),
  expectedUpdatedAt: z.string().min(1).optional(),
});

type Upload = {
  filename: string;
  mimeType: string;
  description: string | undefined;
  content: Buffer;
};

/**
 * Reads the multipart form (one `file` part plus an optional `description`
 * field, in any order) into memory. The 10 MiB cap bounds the buffer; the
 * service then validates type and content.
 */
async function receiveDocument(req: Request): Promise<Upload> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data/i.test(contentType) || !req.body) {
    throw new ValidationError("Expected a multipart/form-data body");
  }
  let busboy: Busboy.Busboy;
  try {
    busboy = Busboy({
      headers: { "content-type": contentType },
      defParamCharset: "utf8",
      limits: { files: 1, fields: 10, parts: 12, fileSize: DOCUMENT_MAX_BYTES },
    });
  } catch {
    throw new ValidationError("Malformed multipart/form-data request");
  }

  let description: string | undefined;
  let file: Omit<Upload, "description"> | undefined;
  let extraFile = false;
  let tooLarge = false;
  const source = Readable.fromWeb(req.body as never);
  try {
    await new Promise<void>((resolve, reject) => {
      busboy.on("field", (name, value) => {
        if (name === "description") description = value;
      });
      busboy.on("file", (_name, stream, info) => {
        if (file) {
          extraFile = true;
          stream.resume();
          return;
        }
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("limit", () => {
          tooLarge = true;
        });
        stream.on("end", () => {
          file = {
            filename: info.filename,
            mimeType: info.mimeType,
            content: Buffer.concat(chunks),
          };
        });
      });
      busboy.on("filesLimit", () => {
        extraFile = true;
      });
      busboy.on("error", reject);
      busboy.on("close", resolve);
      source.on("error", reject);
      source.pipe(busboy);
    });
  } catch {
    throw new ValidationError("Malformed multipart/form-data request");
  }
  if (tooLarge) {
    throw new ValidationError(
      `File exceeds the ${DOCUMENT_MAX_BYTES} byte limit`,
      { reason: "too_large" },
    );
  }
  if (!file) throw new ValidationError('Missing file part in field "file"');
  if (extraFile) {
    throw new ValidationError("Only one file may be uploaded per request");
  }
  return { ...file, description };
}

const markdownFor = (mimeType: string, filename: string, url: string) => {
  const label = filename.replace(/[[\]\\]/g, "\\$&");
  return `${mimeType.startsWith("image/") ? "!" : ""}[${label}](${url})`;
};

/**
 * Document routes. `v1` gets the JSON API; `/files/doc/:id` is mounted on
 * `app` behind the same auth middleware (downloads are never public).
 */
export function mountDocumentRoutes(
  app: Hono<AppEnv>,
  v1: Hono<AppEnv>,
  container: AppContainer,
  auth: MiddlewareHandler<AppEnv>,
) {
  const { documents, trash } = servicesFor(container);
  const storage = fileStorageFor(container);
  const baseUrl = container.config.baseUrl.replace(/\/+$/, "");
  const withUrl = <
    T extends { id: string; filename: string; mimeType: string },
  >(
    d: T,
  ) => {
    const url = `${baseUrl}/files/doc/${d.id}`;
    return { ...d, url, markdown: markdownFor(d.mimeType, d.filename, url) };
  };

  v1.get("/projects/:idOrKey/documents", (c) => {
    const page = documents.list(
      c.req.param("idOrKey"),
      validateQuery(c, listQuery),
    );
    return c.json({ ...page, items: page.items.map(withUrl) });
  });

  v1.post("/projects/:idOrKey/documents", async (c) => {
    const projectRef = c.req.param("idOrKey");
    const actor = c.get("actor");
    const upload = await receiveDocument(c.req.raw);
    const created = await documents.create(actor, projectRef, upload);
    return c.json(withUrl(created), 201);
  });

  v1.get("/documents/:id", (c) =>
    c.json(withUrl(documents.get(c.req.param("id")))),
  );

  v1.patch("/documents/:id", async (c) => {
    const input = await validateBody(c, updateBody);
    input.expectedUpdatedAt ??= ifMatch(c);
    return c.json(withUrl(documents.update(c.req.param("id"), input)));
  });

  v1.delete("/documents/:id", async (c) => {
    const id = c.req.param("id");
    const { purge } = validateQuery(c, purgeQuerySchema);
    const result = await trash.delete(c.get("actor"), "document", id, {
      purge,
    });
    if ("failedFiles" in result) {
      for (const storageKey of result.failedFiles) {
        c.get("logger").error("purged document file not removed", {
          documentId: id,
          storageKey,
        });
      }
    }
    return c.json({ id, deleted: true, purged: purge === true });
  });

  const download = async (c: Context<AppEnv>) => {
    const record = documents.getRecord(c.req.param("id") ?? "");
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
      headers["Content-Length"] = String(size);
      if (c.req.method === "HEAD") {
        stream.destroy();
        return new Response(null, { headers });
      }
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        headers,
      });
    } catch (err) {
      if (err instanceof StorageNotFoundError) {
        throw new NotFoundError("Document file is missing");
      }
      throw err;
    }
  };

  const files = new Hono<AppEnv>();
  files.use(auth);
  files.get("/:id", download);
  app.route("/files/doc", files);
}
