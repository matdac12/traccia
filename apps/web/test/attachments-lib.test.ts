import { describe, expect, it } from "vitest";
import { attachmentIdFromUrl, formatBytes, kindOf, precheck } from "../lib/attachments";

const ID = "01J9ZZZZZZZZZZZZZZZZZZZZZZ";

describe("attachment helpers", () => {
  it("extracts ids from <BASE_URL>/files/<id> only", () => {
    expect(attachmentIdFromUrl(`https://t.example/files/${ID}`)).toBe(ID);
    expect(attachmentIdFromUrl(`https://t.example/base/files/${ID}?x=1`)).toBe(ID);
    expect(attachmentIdFromUrl(`/files/${ID}`)).toBe(ID);
    expect(attachmentIdFromUrl("https://t.example/files/short")).toBeNull();
    expect(attachmentIdFromUrl(`javascript:alert(1)//files/${ID}`)).toBeNull();
    expect(attachmentIdFromUrl("https://t.example/pic.png")).toBeNull();
  });
  it("classifies kinds and formats sizes", () => {
    expect(kindOf("image/png")).toBe("image");
    expect(kindOf("application/pdf")).toBe("pdf");
    expect(kindOf("text/plain")).toBe("file");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10.0 MB");
  });
  it("pre-checks size, emptiness and type like the API", () => {
    expect(precheck({ name: "a.png", type: "image/png", size: 10 })).toBeNull();
    expect(precheck({ name: "n.md", type: "", size: 10 })).toBeNull();
    expect(precheck({ name: "big.pdf", type: "application/pdf", size: 11 * 1024 * 1024 })).toMatch(/limit is 10\.0 MB/);
    expect(precheck({ name: "a.zip", type: "application/zip", size: 10 })).toMatch(/not an allowed type/);
    expect(precheck({ name: "e.txt", type: "text/plain", size: 0 })).toMatch(/empty/);
  });
});
