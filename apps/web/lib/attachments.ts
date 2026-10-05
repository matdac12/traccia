/** Pure attachment helpers shared by the proxy routes, the markdown rewrite and the UI. */

/** Attachment ids are ULIDs. Anything else never reaches an API path. */
export const ATTACHMENT_ID = /^[0-9A-Za-z]{26}$/;

/** Where the browser loads a file from: the dashboard's own proxy route (the browser has no token). */
export const fileUrl = (id: string) => `/api/files/${id}`;

/** The API's default cap (`MAX_ATTACHMENT_BYTES`). The server enforces the real value; this only drives hints. */
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/** Types the API accepts (apps/api/src/storage/validation.ts). */
export const ALLOWED_TYPES = [
  { mime: "image/png", label: "PNG" },
  { mime: "image/jpeg", label: "JPEG" },
  { mime: "image/webp", label: "WebP" },
  { mime: "image/gif", label: "GIF" },
  { mime: "application/pdf", label: "PDF" },
  { mime: "text/plain", label: "TXT" },
  { mime: "text/markdown", label: "MD" },
  { mime: "application/json", label: "JSON" },
] as const;

export const ALLOWED_HINT = `${ALLOWED_TYPES.map((t) => t.label).join(", ")} up to 10 MB`;

export type AttachmentKind = "image" | "pdf" | "file";

export function kindOf(mimeType: string): AttachmentKind {
  if (/^image\/(png|jpeg|webp|gif)$/.test(mimeType)) return "image";
  if (mimeType === "application/pdf") return "pdf";
  return "file";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Browsers often leave `File.type` empty for .md/.json/.txt; fall back to the extension. */
export function guessMime(file: { name: string; type: string }): string {
  if (file.type) return file.type.split(";")[0]!.trim().toLowerCase();
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ({ md: "text/markdown", txt: "text/plain", json: "application/json" } as Record<string, string>)[ext ?? ""] ?? "";
}

/** A message for a file the API would refuse, or null. Mirrors the server so the user hears it before the upload. */
export function precheck(file: { name: string; type: string; size: number }, maxBytes = DEFAULT_MAX_BYTES): string | null {
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > maxBytes) return `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(maxBytes)}.`;
  const mime = guessMime(file);
  if (!ALLOWED_TYPES.some((t) => t.mime === mime)) return `${file.name} is not an allowed type (${ALLOWED_TYPES.map((t) => t.label).join(", ")}).`;
  return null;
}

/**
 * The attachment id in a markdown image URL as `create_attachment` writes it: `<BASE_URL>/files/<id>`.
 * The dashboard does not know the public BASE_URL, so any `…/files/<id>` URL qualifies; the result is
 * only ever the proxy path, so the browser never contacts the original host.
 */
export function attachmentIdFromUrl(url: string): string | null {
  const m = /^(?:https?:\/\/[^/?#]+)?(?:\/[^?#]*)?\/files\/([0-9A-Za-z]{26})\/?(?:[?#].*)?$/.exec(url.trim());
  return m ? m[1]! : null;
}
