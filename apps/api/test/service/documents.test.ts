import { readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { documents } from "../../src/db/schema.js";
import { createServices } from "../../src/service/index.js";
import { LocalDiskStorage } from "../../src/storage/index.js";
import { createTestDb } from "../helpers/test-db.js";
import { onCleanup } from "./helpers.js";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);

afterEach(() => vi.useRealTimers());

async function setup(opts: { allowAgentPurge?: boolean } = {}) {
  const { sqlite, db } = createTestDb();
  onCleanup(() => sqlite.close());
  const dir = await mkdtemp(path.join(tmpdir(), "docs-"));
  onCleanup(() => void rm(dir, { recursive: true, force: true }));
  const services = createServices({
    db,
    defaultIssueKey: "MAT",
    storage: new LocalDiskStorage(dir),
    ...opts,
  });
  const project = services.projects.create("you", { name: "P" });
  const files = () => {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, {
        withFileTypes: true,
      })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else out.push(f);
      }
    };
    walk(dir);
    return out;
  };
  const make = (
    filename: string,
    text: string,
    extra: { description?: string; mimeType?: string } = {},
    projectId = project.id,
  ) =>
    services.documents.create("agent", projectId, {
      filename,
      mimeType: extra.mimeType ?? "text/markdown",
      description: extra.description,
      content: Buffer.from(text),
    });
  const find = (q: string) =>
    db.all<{ ref_id: string }>(
      sql`SELECT ref_id FROM search_index WHERE kind = 'document' AND search_index MATCH ${`"${q}"`}`,
    );
  return { db, services, project, dir, files, make, find };
}

describe("documents: create", () => {
  it("stores the bytes and records metadata without the storage key", async () => {
    const { make, services, files, db } = await setup();
    const d = await make("notes.md", "# hi", { description: "my notes" });
    expect(d).toMatchObject({
      filename: "notes.md",
      mimeType: "text/markdown",
      sizeBytes: 4,
      description: "my notes",
      createdBy: "agent",
      deletedAt: null,
    });
    expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect("storageKey" in d).toBe(false);
    expect(services.documents.get(d.id)).toEqual(d);
    const rec = services.documents.getRecord(d.id);
    expect(files()).toHaveLength(1);
    expect(files()[0]?.endsWith(rec.storageKey)).toBe(true);
    expect(db.select().from(documents).all()).toHaveLength(1);
  });

  it("accepts a stream and sanitizes the filename", async () => {
    const { services, project } = await setup();
    const d = await services.documents.create("you", project.id, {
      filename: "../../etc/pic.png",
      mimeType: "image/png",
      content: Readable.from([PNG]),
    });
    expect(d.filename).toBe("pic.png");
  });

  it("enforces the MIME allowlist, content sniffing and the 10 MiB cap", async () => {
    const { services, project, make, files } = await setup();
    const reject = async (p: Promise<unknown>) =>
      await expect(p).rejects.toMatchObject({ code: "validation_error" });
    await reject(make("a.zip", "x", { mimeType: "application/zip" }));
    await reject(make("a.png", "not a png", { mimeType: "image/png" }));
    await reject(make("a.md", "", { mimeType: "text/markdown" }));
    await reject(make("a.html", "<html></html>", { mimeType: "text/plain" }));
    await reject(
      services.documents.create("you", project.id, {
        filename: "big.txt",
        mimeType: "text/plain",
        content: Buffer.alloc(10 * 1024 * 1024 + 1, 97),
      }),
    );
    const ok = await services.documents.create("you", project.id, {
      filename: "max.txt",
      mimeType: "text/plain",
      content: Buffer.alloc(10 * 1024 * 1024, 97),
    });
    expect(ok.sizeBytes).toBe(10 * 1024 * 1024);
    expect(files()).toHaveLength(1);
  });

  it("caps the description at 2000 chars and rejects unknown projects before storing", async () => {
    const { make, files } = await setup();
    await make("a.md", "x", { description: "d".repeat(2000) });
    await expect(
      make("b.md", "y", { description: "d".repeat(2001) }),
    ).rejects.toMatchObject({ code: "validation_error" });
    await expect(make("c.md", "z", {}, "nope")).rejects.toMatchObject({
      code: "not_found",
    });
    expect(files()).toHaveLength(1);
  });

  it("needs configured storage", async () => {
    const { sqlite, db } = createTestDb();
    onCleanup(() => sqlite.close());
    const services = createServices({ db, defaultIssueKey: "MAT" });
    const p = services.projects.create("you", { name: "P" });
    await expect(
      services.documents.create("you", p.id, {
        filename: "a.md",
        mimeType: "text/markdown",
        content: Buffer.from("x"),
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("dedupes by sha256 within a project: one stored object, two rows", async () => {
    const { make, files, services, project } = await setup();
    const a = await make("a.md", "same bytes");
    const b = await make("b.md", "same bytes");
    expect(b.id).not.toBe(a.id);
    expect(b.sha256).toBe(a.sha256);
    expect(files()).toHaveLength(1);
    expect(services.documents.getRecord(b.id).storageKey).toBe(
      services.documents.getRecord(a.id).storageKey,
    );
    const other = services.projects.create("you", { name: "Other" });
    await make("c.md", "same bytes", {}, other.id);
    expect(files()).toHaveLength(2);
    void project;
  });
});

describe("documents: update, get, list", () => {
  it("updates metadata with optimistic concurrency and re-indexes", async () => {
    const { make, services, find } = await setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-10-10T00:00:00.000Z"));
    const d = await make("old.md", "x", { description: "first" });
    vi.setSystemTime(Date.parse("2026-10-10T00:00:01.000Z"));
    const u = services.documents.update(d.id, {
      filename: "new.md",
      expectedUpdatedAt: d.updatedAt,
    });
    expect(u).toMatchObject({ filename: "new.md", description: "first" });
    expect(find("old")).toEqual([]);
    expect(find("new")).toHaveLength(1);
    expect(() =>
      services.documents.update(d.id, {
        description: "x",
        expectedUpdatedAt: d.updatedAt,
      }),
    ).toThrowError(expect.objectContaining({ code: "conflict" }));
    expect(() => services.documents.update(d.id, {})).toThrowError(
      expect.objectContaining({ code: "validation_error" }),
    );
    expect(() =>
      services.documents.update(d.id, { description: "d".repeat(2001) }),
    ).toThrowError(expect.objectContaining({ code: "validation_error" }));
    expect(() =>
      services.documents.update("nope", { description: "x" }),
    ).toThrowError(expect.objectContaining({ code: "not_found" }));
  });

  it("lists per project with query and keyset pagination", async () => {
    const { make, services, project } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await make(`f${i}.md`, `c${i}`)).id);
    const other = services.projects.create("you", { name: "Other" });
    await make("x.md", "zz", {}, other.id);
    await make("report.md", "r", { description: "quarterly numbers" });
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = services.documents.list(project.id, { limit: 2, cursor });
      seen.push(...page.items.map((d) => d.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(6);
    expect(
      services.documents.list(project.id, { query: "quarterly" }).items,
    ).toHaveLength(1);
    expect(
      services.documents.list(project.id, { query: "REPORT" }).items,
    ).toHaveLength(1);
    expect(() =>
      services.documents.list(project.id, { cursor: "bad" }),
    ).toThrowError(expect.objectContaining({ code: "validation_error" }));
  });
});

describe("documents: search index", () => {
  it("indexes filename + description, never file contents", async () => {
    const { make, find, services } = await setup();
    const d = await make("roadmap.md", "secretcontent", {
      description: "plans for q3",
    });
    expect(find("roadmap").map((r) => r.ref_id)).toEqual([d.id]);
    expect(find("plans")).toHaveLength(1);
    expect(find("secretcontent")).toEqual([]);
    expect(services.search.search({ q: "roadmap" }).items).toEqual([]);
  });

  it("delete removes the row, restore re-adds it", async () => {
    const { make, find, services } = await setup();
    const d = await make("roadmap.md", "x");
    services.documents.delete("you", d.id);
    expect(find("roadmap")).toEqual([]);
    services.documents.restore("you", d.id);
    expect(find("roadmap")).toHaveLength(1);
  });
});

describe("documents: delete, restore, purge", () => {
  it("soft delete keeps the file; restore revives; deleted is not_found", async () => {
    const { make, services, files } = await setup();
    const d = await make("a.md", "x");
    const r = services.documents.delete("agent", d.id);
    expect(r).toMatchObject({
      type: "document",
      title: "a.md",
      counts: { documents: 1 },
    });
    expect(() => services.documents.get(d.id)).toThrowError(
      expect.objectContaining({ code: "not_found" }),
    );
    expect(() => services.documents.getRecord(d.id)).toThrowError(
      expect.objectContaining({ code: "not_found" }),
    );
    expect(files()).toHaveLength(1);
    expect(services.trash.list({ type: "document" }).items).toHaveLength(1);
    services.documents.restore("you", d.id);
    expect(services.documents.get(d.id).deletedAt).toBeNull();
  });

  it("purge deletes the row and the file after commit; agents may (ADR 0015)", async () => {
    const { make, services, files, db } = await setup();
    const d = await make("a.md", "x");
    await expect(services.documents.purge("agent", d.id)).rejects.toMatchObject(
      {
        code: "conflict",
      },
    );
    services.documents.delete("agent", d.id);
    const r = await services.documents.purge("agent", d.id);
    expect(r).toMatchObject({ counts: { documents: 1 }, failedFiles: [] });
    expect(files()).toEqual([]);
    expect(
      db.select().from(documents).where(eq(documents.id, d.id)).all(),
    ).toEqual([]);
  });

  it("a shared object survives until the last document referencing it is purged", async () => {
    const { make, services, files } = await setup();
    const a = await make("a.md", "dup");
    const b = await make("b.md", "dup");
    services.documents.delete("you", a.id);
    await services.documents.purge("you", a.id);
    expect(files()).toHaveLength(1);
    services.documents.delete("you", b.id);
    await services.documents.purge("you", b.id);
    expect(files()).toEqual([]);
  });

  it("follows a project delete and purge, including the files", async () => {
    const { make, services, files, project, find } = await setup();
    const d = await make("a.md", "x");
    const del = services.trash.softDelete("you", "project", project.id);
    expect(del.counts).toMatchObject({ projects: 1, documents: 1 });
    expect(find("a")).toEqual([]);
    expect(() => services.documents.get(d.id)).toThrowError(
      expect.objectContaining({ code: "not_found" }),
    );
    expect(() => services.documents.restore("you", d.id)).toThrowError(
      expect.objectContaining({ code: "conflict" }),
    );
    services.trash.restore("you", "project", project.id);
    expect(services.documents.get(d.id).filename).toBe("a.md");
    services.trash.softDelete("you", "project", project.id);
    await services.trash.purge("you", "project", project.id);
    expect(files()).toEqual([]);
  });
});
