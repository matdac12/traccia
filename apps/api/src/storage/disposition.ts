import { stripLoneSurrogates } from "./filename.js";

const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

/** `inline` only for images and PDF; everything else is forced to download. */
export function dispositionFor(mimeType: string): "inline" | "attachment" {
  return INLINE_TYPES.has(mimeType.toLowerCase()) ? "inline" : "attachment";
}

/** Full `Content-Disposition` header value for a stored attachment. */
export function contentDisposition(
  mimeType: string,
  rawFilename: string,
): string {
  const filename = stripLoneSurrogates(rawFilename);
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${dispositionFor(mimeType)}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
