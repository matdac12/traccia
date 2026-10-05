import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG_ENV_VARS } from "../src/config.js";

const root = resolve(import.meta.dirname, "../../..");
const readme = readFileSync(resolve(root, "README.md"), "utf8");

/** Variable names in the first column of the README's config table, e.g. | `PORT` | ... */
const documented = [...readme.matchAll(/^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|/gm)].map(
  (m) => m[1] ?? "",
);

describe("README", () => {
  it("documents every variable read by config.ts", () => {
    const missing = CONFIG_ENV_VARS.filter((v) => !documented.includes(v));
    expect(missing).toEqual([]);
  });

  it("documents no api variable that config.ts does not read", () => {
    const apiRows = readme
      .split("\n")
      .filter((l) => /^\|\s*`[A-Z][A-Z0-9_]*`\s*\|\s*api\s*\|/.test(l))
      .map((l) => l.match(/`([A-Z0-9_]+)`/)?.[1]);
    expect(apiRows.filter((v) => !CONFIG_ENV_VARS.includes(v ?? ""))).toEqual(
      [],
    );
  });

  it("documents the web variables under their TRACCIA_* names", () => {
    const webRows = readme
      .split("\n")
      .filter((l) => /^\|\s*`[A-Z][A-Z0-9_]*`\s*\|\s*web\s*\|/.test(l))
      .map((l) => l.match(/`([A-Z0-9_]+)`/)?.[1]);
    expect(webRows).toContain("TRACCIA_API_URL");
    expect(webRows).toContain("TRACCIA_API_TOKEN");
    expect(webRows.filter((v) => v?.startsWith("TRACKER_"))).toEqual([]);
  });

  it("has relative links that resolve to files in the repo", () => {
    const links = [...readme.matchAll(/\]\((?!https?:|#)([^)#\s]+)/g)].map(
      (m) => m[1] ?? "",
    );
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(existsSync(resolve(root, link)), link).toBe(true);
    }
  });
});
