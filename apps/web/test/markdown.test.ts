import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../components/issue-detail/markdown";

const html = (md: string) => renderToStaticMarkup(createElement(Markdown, null, md));

describe("Markdown sanitization", () => {
  it("renders ordinary markdown", () => {
    const out = html("# Title\n\nsome **bold** and `code`\n\n- [x] done\n- [ ] todo\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(out).toContain("<h1>Title</h1>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<code>code</code>");
    expect(out).toContain('type="checkbox"');
    expect(out).toContain("<table>");
  });
  it("drops script tags", () => {
    const out = html("hi <script>alert(1)</script> there\n\n<script>alert(2)</script>");
    expect(out).not.toMatch(/<script/i);
  });
  it("drops inline event handlers and raw html elements", () => {
    const out = html('<img src="x" onerror="alert(1)"> <a href="https://e.x" onclick="alert(1)">x</a> <iframe src="https://e.x"></iframe>');
    expect(out).not.toMatch(/onerror|onclick|<iframe|<img/i);
  });
  it("strips javascript: links, in any casing or entity-encoded form", () => {
    for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "&#106;avascript:alert(1)", "data:text/html,<b>x</b>", "vbscript:x"]) {
      const out = html(`[click](${href}) <a href="${href}">raw</a>`);
      expect(out).not.toMatch(/javascript:|vbscript:|data:text/i);
    }
  });
  it("blocks javascript: image sources", () => {
    expect(html("![x](javascript:alert(1))")).not.toMatch(/javascript:/i);
  });
  it("does not render remote images", () => {
    expect(html("![t](https://traccia.example/p.png)")).not.toMatch(/<img|tracker\.example/);
  });
  it("rewrites <BASE_URL>/files/<id> images to the proxy route", () => {
    const id = "01J9ZZZZZZZZZZZZZZZZZZZZZZ";
    for (const url of [`https://traccia.example/files/${id}`, `http://100.64.0.1:8787/files/${id}`, `/files/${id}`]) {
      const out = html(`![shot](${url})`);
      expect(out).toContain(`src="/api/files/${id}"`);
      expect(out).toContain('alt="shot"');
      expect(out).not.toMatch(/tracker\.example|100\.64/);
    }
  });
  it("still drops images that are not attachments, even with a /files/ look-alike", () => {
    for (const url of ["https://evil.example/x.png", "//evil.example/files/short", "/api/files/../../x", "https://evil.example/files/abc"]) {
      expect(html(`![t](${url})`)).not.toMatch(/<img|evil/);
    }
  });
  it("keeps https links and opens them safely", () => {
    const out = html("[docs](https://example.com/a)");
    expect(out).toContain('href="https://example.com/a"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('target="_blank"');
  });
});
