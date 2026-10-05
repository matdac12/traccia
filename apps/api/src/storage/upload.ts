import { type Readable, pipeline } from "node:stream";
import type { AttachmentStorage } from "./storage.js";
import { type UploadResult, createUploadInspector } from "./validation.js";

/**
 * Validates `source` while streaming it into storage under `key`.
 * On any validation or I/O error nothing is left behind (storage cleans its temp file).
 */
export async function storeUpload(
  storage: AttachmentStorage,
  key: string,
  source: Readable,
  opts: { declaredMimeType: string; maxBytes: number },
): Promise<UploadResult> {
  const inspector = createUploadInspector(opts);
  // pipeline() destroys every stream with the error, so storage.put rejects too.
  const validated = pipeline(source, inspector.stream, () => {});
  await storage.put(key, validated, { mimeType: opts.declaredMimeType });
  return inspector.result();
}
