import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AttachmentValidationError,
  LocalDiskStorage,
  storeUpload,
} from "../src/storage/index.js";

const SAMPLES: Record<string, Buffer> = {
  "image/png": Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
  "image/jpeg": Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0"),
    Buffer.from([0xff, 0xd9]),
  ]),
  "image/gif": Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64",
  ),
  "image/webp": Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([0x1a, 0, 0, 0]),
    Buffer.from("WEBPVP8 "),
    Buffer.alloc(14),
  ]),
  "application/pdf": Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  ),
  "text/plain": Buffer.from("just some text, with ünïcode ✓\nand lines\n"),
  "text/markdown": Buffer.from(
    "# Title\n\n- item\n\n```ts\nconst a = 1;\n```\n",
  ),
  "application/json": Buffer.from('{"a":[1,2,3],"b":"✓"}'),
};

describe("storeUpload", () => {
  let dir: string;
  let storage: LocalDiskStorage;
  const maxBytes = 1024 * 1024;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "upload-"));
    storage = new LocalDiskStorage(dir);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const files = async () =>
    (await readdir(dir, { recursive: true, withFileTypes: true })).filter((e) =>
      e.isFile(),
    );

  const upload = (data: Buffer | Readable, declared: string, max = maxBytes) =>
    storeUpload(
      storage,
      "2026/10/key",
      Buffer.isBuffer(data) ? Readable.from([data]) : data,
      { declaredMimeType: declared, maxBytes: max },
    );

  const rejects = async (p: Promise<unknown>, code: string) => {
    const err = await p.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AttachmentValidationError);
    expect((err as AttachmentValidationError).code).toBe(code);
    expect(await files()).toHaveLength(0);
  };

  it.each(Object.entries(SAMPLES))(
    "accepts a real %s sample",
    async (mime, data) => {
      const result = await upload(data, mime);
      expect(result.mimeType).toBe(mime);
      expect(result.sizeBytes).toBe(data.length);
      const { createHash } = await import("node:crypto");
      expect(result.sha256).toBe(
        createHash("sha256").update(data).digest("hex"),
      );
      const stored = await storage.get("2026/10/key");
      expect(stored.size).toBe(data.length);
    },
  );

  it("normalizes declared type parameters and case", async () => {
    const result = await upload(
      SAMPLES["text/plain"] as Buffer,
      "Text/Plain; charset=utf-8",
    );
    expect(result.mimeType).toBe("text/plain");
  });

  it("hashes and stores correctly across many chunks", async () => {
    const big = Buffer.from("line of text\n".repeat(5000));
    const chunks = Array.from({ length: Math.ceil(big.length / 100) }, (_, i) =>
      big.subarray(i * 100, (i + 1) * 100),
    );
    const result = await upload(Readable.from(chunks), "text/plain");
    expect(result.sizeBytes).toBe(big.length);
    expect(await files()).toHaveLength(1);
  });

  it("rejects a PNG declared as application/pdf", async () => {
    await rejects(
      upload(SAMPLES["image/png"] as Buffer, "application/pdf"),
      "type_mismatch",
    );
  });

  it("rejects a PDF declared as an image", async () => {
    await rejects(
      upload(SAMPLES["application/pdf"] as Buffer, "image/png"),
      "type_mismatch",
    );
  });

  it("rejects an image declared as text/plain", async () => {
    await rejects(
      upload(SAMPLES["image/png"] as Buffer, "text/plain"),
      "type_mismatch",
    );
  });

  it("rejects text declared as an image", async () => {
    await rejects(
      upload(SAMPLES["text/plain"] as Buffer, "image/png"),
      "type_mismatch",
    );
  });

  it.each([
    ["HTML", "<!DOCTYPE html><html><script>alert(1)</script></html>"],
    ["HTML with leading whitespace", "\n  <html><body>x</body></html>"],
    ["script tag", "<script>alert(1)</script>"],
    ["shebang script", "#!/bin/sh\nrm -rf /\n"],
  ])("rejects %s declared as text/plain", async (_n, payload) => {
    await rejects(upload(Buffer.from(payload), "text/plain"), "type_mismatch");
  });

  it.each([
    ["ELF", Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0, 0])],
    ["Mach-O", Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1])],
    ["ZIP", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0])],
  ])("rejects %s executable declared as text/plain", async (_n, payload) => {
    await rejects(upload(payload, "text/plain"), "type_mismatch");
  });

  it("rejects a Windows PE executable declared as text/plain", async () => {
    await rejects(
      upload(Buffer.from("MZ\x90\0\x03\0\0\0"), "text/plain"),
      "invalid_text",
    );
  });

  it("rejects HTML hidden behind a UTF-8 BOM", async () => {
    const data = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("<html><script>alert(1)</script></html>"),
    ]);
    await rejects(upload(data, "text/plain"), "type_mismatch");
  });

  it("rejects HTML hidden behind a leading comment", async () => {
    await rejects(
      upload(
        Buffer.from("<!-- x -->\n<script>alert(1)</script>"),
        "text/plain",
      ),
      "type_mismatch",
    );
  });

  it.each([
    ["text/plain", "MZ is a fine way to start a note\n"],
    ["text/markdown", "<!-- draft -->\n# Title\n"],
    ["text/markdown", "#!important heading-ish\n"],
  ])("accepts legitimate %s starting %j", async (mime, text) => {
    await upload(Buffer.from(text), mime);
  });

  it("accepts text with ANSI escape sequences", async () => {
    await upload(
      Buffer.from("\u001b[31mred\u001b[0m log line\n"),
      "text/plain",
    );
  });

  it("rejects NUL bytes in text beyond the sniffed head", async () => {
    const data = Buffer.concat([
      Buffer.from("a".repeat(2000)),
      Buffer.from([0]),
      Buffer.from("b"),
    ]);
    await rejects(upload(data, "text/plain"), "invalid_text");
  });

  it("rejects invalid UTF-8", async () => {
    await rejects(
      upload(Buffer.from([0x68, 0x69, 0xff, 0xfe, 0x0a]), "text/plain"),
      "invalid_text",
    );
  });

  it("rejects a truncated multi-byte sequence at end of file", async () => {
    await rejects(
      upload(Buffer.from([0x68, 0xe2, 0x9c]), "text/markdown"),
      "invalid_text",
    );
  });

  it("accepts a multi-byte character split across chunks", async () => {
    const bytes = Buffer.from("✓✓✓");
    const result = await upload(
      Readable.from([
        bytes.subarray(0, 1),
        bytes.subarray(1, 5),
        bytes.subarray(5),
      ]),
      "text/plain",
    );
    expect(result.sizeBytes).toBe(bytes.length);
  });

  it("rejects JSON that does not parse", async () => {
    await rejects(
      upload(Buffer.from('{"a":'), "application/json"),
      "invalid_json",
    );
  });

  it("accepts JSON with a UTF-8 BOM", async () => {
    await upload(
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}")]),
      "application/json",
    );
  });

  it("rejects unsupported declared types", async () => {
    await rejects(
      upload(Buffer.from("<svg/>"), "image/svg+xml"),
      "unsupported_type",
    );
    await rejects(upload(Buffer.from("x"), "text/html"), "unsupported_type");
    await rejects(upload(Buffer.from("x"), ""), "unsupported_type");
  });

  it("rejects empty files", async () => {
    await rejects(upload(Buffer.alloc(0), "text/plain"), "empty");
  });

  it("rejects oversize uploads mid-stream without leaving a partial file", async () => {
    let produced = 0;
    const endless = new Readable({
      read() {
        produced += 1000;
        this.push(Buffer.from("a".repeat(1000)));
      },
    });
    await rejects(upload(endless, "text/plain", 5000), "too_large");
    // The source stopped being consumed shortly after the limit was hit.
    expect(produced).toBeLessThan(5000 + 200_000);
  });

  it("accepts a file of exactly the limit", async () => {
    const data = Buffer.from("a".repeat(5000));
    const result = await upload(data, "text/plain", 5000);
    expect(result.sizeBytes).toBe(5000);
  });
});
