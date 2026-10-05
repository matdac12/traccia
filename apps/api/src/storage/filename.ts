const MAX_FILENAME_LENGTH = 200;
const FALLBACK_NAME = "file";

/**
 * Reduces a user-supplied filename to a safe display name: no path segments,
 * control or invisible characters, no leading dots, bounded length, extension kept.
 */
export function sanitizeFilename(input: string): string {
  const lastSegment =
    input
      .normalize("NFC")
      .split(/[\\/]/)
      .filter((s) => s.trim() !== "")
      .pop() ?? "";

  const cleaned = lastSegment
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/[:*?"<>|]/g, "_")
    .trim()
    .replace(/^\.+/, "")
    .trim();

  if (cleaned === "") return FALLBACK_NAME;

  const chars = Array.from(cleaned);
  if (chars.length <= MAX_FILENAME_LENGTH) return cleaned;

  const ext = /\.[A-Za-z0-9]{1,16}$/.exec(cleaned)?.[0] ?? "";
  const base = chars.slice(0, MAX_FILENAME_LENGTH - ext.length).join("");
  return base + ext;
}
