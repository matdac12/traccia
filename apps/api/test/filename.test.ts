import { describe, expect, it } from "vitest";
import {
  contentDisposition,
  dispositionFor,
  sanitizeFilename,
} from "../src/storage/index.js";

describe("sanitizeFilename", () => {
  it.each([
    ["../../etc/passwd", "passwd"],
    ["C:\\Users\\me\\shot.png", "shot.png"],
    ["dir/", "dir"],
    ["", "file"],
    ["   ", "file"],
    ["/", "file"],
    ["..", "file"],
    [".hidden", "hidden"],
    ["a\u0000b\u0007c.txt", "abc.txt"],
    ["evil\u202Egnp.exe", "evilgnp.exe"],
    ['we:ird*na?me"<>|.md', "we_ird_na_me____.md"],
    ["  spaced.png  ", "spaced.png"],
  ])("%j -> %j", (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it("keeps unicode names", () => {
    expect(sanitizeFilename("スクリーンショット 📸.png")).toBe(
      "スクリーンショット 📸.png",
    );
  });

  it("normalizes to NFC", () => {
    expect(sanitizeFilename("cafe\u0301.txt")).toBe("caf\u00e9.txt");
  });

  it("limits very long names and keeps the extension", () => {
    const out = sanitizeFilename(`${"a".repeat(1000)}.png`);
    expect(Array.from(out)).toHaveLength(200);
    expect(out.endsWith(".png")).toBe(true);
  });

  it("does not split surrogate pairs when truncating", () => {
    const out = sanitizeFilename(`${"📸".repeat(500)}.png`);
    expect(Array.from(out)).toHaveLength(200);
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe("dispositionFor", () => {
  it.each([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "application/pdf",
  ])("%s is inline", (t) => expect(dispositionFor(t)).toBe("inline"));
  it.each([
    "text/plain",
    "text/markdown",
    "application/json",
    "text/html",
    "image/svg+xml",
  ])("%s is attachment", (t) => expect(dispositionFor(t)).toBe("attachment"));
});

describe("contentDisposition", () => {
  it("builds an ASCII fallback and an RFC 5987 filename*", () => {
    expect(contentDisposition("image/png", 'sh"ot é.png')).toBe(
      `inline; filename="sh_ot _.png"; filename*=UTF-8''sh%22ot%20%C3%A9.png`,
    );
  });
});
