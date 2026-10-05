import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generateStorageKey,
  InvalidStorageKeyError,
  LocalDiskStorage,
  StorageNotFoundError,
} from "../src/storage/index.js";

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name);
}

describe("LocalDiskStorage", () => {
  let dir: string;
  let storage: LocalDiskStorage;
  const meta = { mimeType: "text/plain" };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "attachments-"));
    storage = new LocalDiskStorage(dir);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("round-trips a Buffer through put/get/delete", async () => {
    const key = generateStorageKey();
    await storage.put(key, Buffer.from("hello"), meta);
    const { stream, size } = await storage.get(key);
    expect(size).toBe(5);
    expect((await readAll(stream)).toString()).toBe("hello");

    await storage.delete(key);
    await expect(storage.get(key)).rejects.toBeInstanceOf(StorageNotFoundError);
  });

  it("streams a Readable into storage", async () => {
    const key = generateStorageKey();
    await storage.put(
      key,
      Readable.from([Buffer.from("ab"), Buffer.from("cd")]),
      meta,
    );
    expect((await readAll((await storage.get(key)).stream)).toString()).toBe(
      "abcd",
    );
  });

  it("delete is idempotent", async () => {
    await expect(storage.delete("2026/10/missing")).resolves.toBeUndefined();
  });

  it("treats a directory key as not found on get and rejects it on delete", async () => {
    await storage.put("2026/10/abc", Buffer.from("x"), meta);
    await expect(storage.get("2026/10")).rejects.toBeInstanceOf(
      StorageNotFoundError,
    );
    await expect(storage.delete("2026/10")).rejects.toBeInstanceOf(
      InvalidStorageKeyError,
    );
    // the file inside is untouched
    expect(
      (await readAll((await storage.get("2026/10/abc")).stream)).toString(),
    ).toBe("x");
  });

  it("leaves no temp file after a successful put", async () => {
    await storage.put(generateStorageKey(), Buffer.from("x"), meta);
    expect(await listFiles(dir)).toHaveLength(1);
  });

  it("leaves no partial file when the source stream fails", async () => {
    const failing = new Readable({
      read() {
        this.push(Buffer.from("partial"));
        this.destroy(new Error("boom"));
      },
    });
    await expect(storage.put("2026/10/abc", failing, meta)).rejects.toThrow(
      "boom",
    );
    expect(await listFiles(dir)).toEqual([]);
  });

  it.each([
    "../escape",
    "2026/../../escape",
    "/etc/passwd",
    "a/./b",
    "a//b",
    "a\\..\\b",
    "a/b\0c",
    "",
    "..",
  ])("rejects traversal key %j", async (key) => {
    await expect(
      storage.put(key, Buffer.from("x"), meta),
    ).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(storage.get(key)).rejects.toBeInstanceOf(
      InvalidStorageKeyError,
    );
    await expect(storage.delete(key)).rejects.toBeInstanceOf(
      InvalidStorageKeyError,
    );
  });
});

describe("generateStorageKey", () => {
  it("uses <yyyy>/<mm>/<ulid> from UTC date", () => {
    const key = generateStorageKey(new Date("2026-03-05T12:00:00Z"));
    expect(key).toMatch(/^2026\/03\/[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});
