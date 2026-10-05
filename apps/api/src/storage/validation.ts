import { createHash } from "node:crypto";
import { Transform } from "node:stream";

export const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/json",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export type ValidationErrorCode =
  | "unsupported_type"
  | "type_mismatch"
  | "too_large"
  | "empty"
  | "invalid_text"
  | "invalid_json";

export class AttachmentValidationError extends Error {
  override name = "AttachmentValidationError";
  constructor(
    readonly code: ValidationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type SniffedType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif"
  | "application/pdf"
  | "text"
  | "binary";

/** Enough leading bytes to recognise every signature and the HTML/script prefixes. */
const HEAD_BYTES = 512;

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length &&
  bytes.every((b, i) => buf[offset + i] === b);

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/**
 * Unambiguous signatures of formats that must never pass as text. Short or
 * text-like prefixes (MZ, gzip) are left out: those files contain control or
 * non-UTF-8 bytes and are rejected by the full-stream text checks instead.
 */
const BINARY_SIGNATURES: number[][] = [
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xfe, 0xed, 0xfa, 0xce], // Mach-O
  [0xfe, 0xed, 0xfa, 0xcf],
  [0xce, 0xfa, 0xed, 0xfe],
  [0xcf, 0xfa, 0xed, 0xfe],
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O fat / Java class
  [0x50, 0x4b, 0x03, 0x04], // ZIP
];

const HTML_PREFIX =
  /^(?:<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<script[\s>]|<iframe[\s>]|<svg[\s>]|<\?xml)/i;

const SHEBANG = /^#!\s*\//;
const LEADING_NOISE = /^(?:\s+|<!--[\s\S]*?-->)+/;
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Classifies content by its leading bytes, ignoring any declared type. */
export function sniffType(head: Buffer): SniffedType {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(head, ascii("GIF87a")) || startsWith(head, ascii("GIF89a"))) {
    return "image/gif";
  }
  if (startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8)) {
    return "image/webp";
  }
  if (startsWith(head, ascii("%PDF-"))) return "application/pdf";
  if (BINARY_SIGNATURES.some((sig) => startsWith(head, sig))) return "binary";

  // Look past a UTF-8 BOM, whitespace and leading HTML comments (markdown may
  // legitimately start with a comment) before testing for HTML/script prefixes.
  const body = startsWith(head, [...UTF8_BOM]) ? head.subarray(3) : head;
  const prefix = body.toString("latin1").replace(LEADING_NOISE, "");
  if (HTML_PREFIX.test(prefix) || SHEBANG.test(prefix)) return "binary";

  return "text";
}

/** Lowercases and strips parameters: `Text/Plain; charset=utf-8` -> `text/plain`. */
export function normalizeMimeType(declared: string): string {
  return (declared.split(";")[0] ?? "").trim().toLowerCase();
}

const TEXT_TYPES = new Set(["text/plain", "text/markdown", "application/json"]);

/** True if the chunk has a control byte other than tab, LF, FF, CR or ESC (ANSI colours in logs). */
function hasControlBytes(chunk: Buffer): boolean {
  for (const b of chunk) {
    if (
      b < 0x20 &&
      b !== 0x09 &&
      b !== 0x0a &&
      b !== 0x0c &&
      b !== 0x0d &&
      b !== 0x1b
    ) {
      return true;
    }
  }
  return false;
}

export type UploadResult = {
  mimeType: AllowedMimeType;
  sizeBytes: number;
  sha256: string;
};

export type UploadInspector = {
  /** Pass-through stream; errors with AttachmentValidationError on any violation. */
  stream: Transform;
  /** Available once the stream has ended without error. */
  result(): UploadResult;
};

/**
 * Validates an upload while it streams: size cap, magic-byte sniffing versus the
 * declared type, UTF-8 / JSON checks for text types, and a running sha256.
 * Bytes are only forwarded after the head has been classified, so a mismatching
 * payload never reaches storage.
 */
export function createUploadInspector(opts: {
  declaredMimeType: string;
  maxBytes: number;
}): UploadInspector {
  const declared = normalizeMimeType(opts.declaredMimeType);
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(declared)) {
    throw new AttachmentValidationError(
      "unsupported_type",
      `Unsupported file type: ${declared || "(none)"}`,
    );
  }
  const mimeType = declared as AllowedMimeType;
  const isText = TEXT_TYPES.has(mimeType);

  const hash = createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const textParts: string[] = [];
  let size = 0;
  let held: Buffer[] = [];
  let heldBytes = 0;
  let classified = false;
  let done: UploadResult | undefined;

  const scan = (chunk: Buffer, final: boolean) => {
    if (!isText) return;
    if (hasControlBytes(chunk)) {
      throw new AttachmentValidationError(
        "invalid_text",
        "Text file contains binary control characters",
      );
    }
    try {
      const text = decoder.decode(chunk, { stream: !final });
      if (mimeType === "application/json") textParts.push(text);
    } catch {
      throw new AttachmentValidationError(
        "invalid_text",
        "Text file is not valid UTF-8",
      );
    }
  };

  const classify = (head: Buffer) => {
    const sniffed = sniffType(head);
    const expected = isText ? "text" : mimeType;
    if (sniffed !== expected) {
      throw new AttachmentValidationError(
        "type_mismatch",
        `Content does not match declared type ${mimeType}`,
      );
    }
    classified = true;
  };

  const stream = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      try {
        size += chunk.length;
        if (size > opts.maxBytes) {
          throw new AttachmentValidationError(
            "too_large",
            `File exceeds the ${opts.maxBytes} byte limit`,
          );
        }
        hash.update(chunk);
        if (classified) {
          scan(chunk, false);
          cb(null, chunk);
          return;
        }
        held.push(chunk);
        heldBytes += chunk.length;
        if (heldBytes < HEAD_BYTES) {
          cb();
          return;
        }
        const head = Buffer.concat(held);
        classify(head);
        held = [];
        scan(head, false);
        cb(null, head);
      } catch (err) {
        cb(err as Error);
      }
    },
    flush(cb) {
      try {
        if (size === 0) {
          throw new AttachmentValidationError("empty", "File is empty");
        }
        let tail = Buffer.alloc(0);
        if (!classified) {
          tail = Buffer.concat(held);
          classify(tail);
        }
        scan(tail, true);
        if (mimeType === "application/json") {
          try {
            JSON.parse(textParts.join(""));
          } catch {
            throw new AttachmentValidationError(
              "invalid_json",
              "File is not valid JSON",
            );
          }
        }
        done = { mimeType, sizeBytes: size, sha256: hash.digest("hex") };
        cb(null, tail.length > 0 ? tail : undefined);
      } catch (err) {
        cb(err as Error);
      }
    },
  });

  return {
    stream,
    result() {
      if (!done) throw new Error("Upload has not completed successfully");
      return done;
    },
  };
}
