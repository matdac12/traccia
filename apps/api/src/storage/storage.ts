import type { Readable } from "node:stream";

export interface AttachmentStorage {
  put(
    key: string,
    data: Buffer | Readable,
    meta: { mimeType: string },
  ): Promise<void>;
  get(key: string): Promise<{ stream: Readable; size: number }>;
  delete(key: string): Promise<void>;
}

export class InvalidStorageKeyError extends Error {
  override name = "InvalidStorageKeyError";
}

export class StorageNotFoundError extends Error {
  override name = "StorageNotFoundError";
}
