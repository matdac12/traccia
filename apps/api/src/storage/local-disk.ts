import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  type AttachmentStorage,
  InvalidStorageKeyError,
  StorageNotFoundError,
} from "./storage.js";

const notFound = (key: string) =>
  new StorageNotFoundError(`No such attachment: ${key}`);

/** Stores attachments under `root` (normally `${DATA_DIR}/attachments`). */
export class LocalDiskStorage implements AttachmentStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Maps a key to an absolute path, rejecting anything that could leave the root. */
  private resolveKey(key: string): string {
    const segments = key.split("/");
    if (
      key === "" ||
      key.includes("\0") ||
      key.includes("\\") ||
      segments.some((s) => s === "" || s === "." || s === "..")
    ) {
      throw new InvalidStorageKeyError(`Invalid storage key: ${key}`);
    }
    const full = path.resolve(this.root, ...segments);
    if (!full.startsWith(this.root + path.sep)) {
      throw new InvalidStorageKeyError(`Invalid storage key: ${key}`);
    }
    return full;
  }

  async put(
    key: string,
    data: Buffer | Readable,
    _meta: { mimeType: string },
  ): Promise<void> {
    const target = this.resolveKey(key);
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    const source = Buffer.isBuffer(data) ? Readable.from([data]) : data;
    try {
      await pipeline(source, createWriteStream(tmp, { flags: "wx" }));
      await rename(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  async get(key: string): Promise<{ stream: Readable; size: number }> {
    const target = this.resolveKey(key);
    try {
      const info = await stat(target);
      if (!info.isFile()) throw notFound(key);
      return { stream: createReadStream(target), size: info.size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw notFound(key);
      throw err;
    }
  }

  /** Idempotent for missing keys; keys that are not files (directories) are rejected. */
  async delete(key: string): Promise<void> {
    const target = this.resolveKey(key);
    try {
      if (!(await lstat(target)).isFile()) {
        throw new InvalidStorageKeyError(`Key is not a file: ${key}`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    await rm(target, { force: true });
  }
}
