import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memories } from "../../src/db/schema.js";
import { code, setupServices } from "./helpers.js";

afterEach(() => vi.useRealTimers());

/** Freezes `Date` only (timers stay real) and lets a test move it forward deterministically. */
function freezeClock() {
  vi.useFakeTimers({ toFake: ["Date"] });
  let t = Date.parse("2026-10-10T00:00:00.000Z");
  vi.setSystemTime(t);
  return () => {
    t += 1000;
    vi.setSystemTime(t);
  };
}

function setup() {
  const s = setupServices();
  const project = s.services.projects.create("you", { name: "P" });
  const save = (title: string, extra: Record<string, unknown> = {}) =>
    s.services.memories.save("agent", { project: project.id, title, ...extra });
  const find = (q: string) =>
    s.db.all<{ ref_id: string }>(
      sql`SELECT ref_id FROM search_index WHERE kind = 'memory' AND search_index MATCH ${`"${q}"`}`,
    );
  return { ...s, project, save, find };
}

describe("memories: save and get", () => {
  it("creates with defaults, stamps created_by and exposes tags as an array", () => {
    const { save, services } = setup();
    const m = save("Deploy", {
      body: "use pnpm",
      tags: ["ops", "ops", " ci "],
    });
    expect(m).toMatchObject({
      title: "Deploy",
      body: "use pnpm",
      tags: ["ops", "ci"],
      createdBy: "agent",
      deletedAt: null,
    });
    expect(services.memories.get(m.id)).toEqual(m);
    expect(save("Bare")).toMatchObject({ body: "", tags: [] });
  });

  it("requires project and title to create, and a field to update", () => {
    const { services, save, project } = setup();
    expect(code(() => services.memories.save("agent", { title: "x" }))).toBe(
      "validation_error",
    );
    expect(
      code(() => services.memories.save("agent", { project: project.id })),
    ).toBe("validation_error");
    const m = save("a");
    expect(code(() => services.memories.save("agent", { id: m.id }))).toBe(
      "validation_error",
    );
  });

  it("updates only given fields and moves updatedAt", () => {
    const { services, save } = setup();
    const tick = freezeClock();
    const m = save("a", { body: "b", tags: ["t"] });
    tick();
    const u = services.memories.save("you", { id: m.id, body: "new" });
    expect(u).toMatchObject({ title: "a", body: "new", tags: ["t"] });
    expect(u.updatedAt > m.updatedAt).toBe(true);
    expect(u.createdBy).toBe("agent");
  });

  it("rejects moving a memory to another project", () => {
    const { services, save } = setup();
    const other = services.projects.create("you", { name: "Other" });
    const m = save("a");
    expect(
      code(() =>
        services.memories.save("you", {
          id: m.id,
          project: other.id,
          title: "b",
        }),
      ),
    ).toBe("validation_error");
  });

  it("enforces optimistic concurrency with currentUpdatedAt", () => {
    const { services, save } = setup();
    const tick = freezeClock();
    const m = save("a");
    tick();
    services.memories.save("you", {
      id: m.id,
      title: "b",
      expectedUpdatedAt: m.updatedAt,
    });
    try {
      services.memories.save("you", {
        id: m.id,
        title: "c",
        expectedUpdatedAt: m.updatedAt,
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ code: "conflict" });
      expect((e as { details: unknown }).details).toMatchObject({
        currentUpdatedAt: expect.any(String),
      });
    }
    expect(services.memories.get(m.id).title).toBe("b");
  });

  it("unknown id is not_found", () => {
    const { services } = setup();
    expect(code(() => services.memories.get("nope"))).toBe("not_found");
    expect(
      code(() => services.memories.save("you", { id: "nope", title: "x" })),
    ).toBe("not_found");
  });
});

describe("memories: caps", () => {
  it("title <= 200 chars, body <= 64 KiB, <= 20 tags", () => {
    const { save, services } = setup();
    expect(save("t".repeat(200)).title).toHaveLength(200);
    expect(code(() => save("t".repeat(201)))).toBe("validation_error");
    expect(code(() => save(""))).toBe("validation_error");
    expect(code(() => save("   "))).toBe("validation_error");
    expect(save("b", { body: "x".repeat(64 * 1024) }).body).toHaveLength(65536);
    expect(code(() => save("b", { body: "x".repeat(64 * 1024 + 1) }))).toBe(
      "validation_error",
    );
    // the cap is in bytes, not characters
    expect(code(() => save("b", { body: "é".repeat(32 * 1024 + 1) }))).toBe(
      "validation_error",
    );
    const tags = Array.from({ length: 20 }, (_, i) => `t${i}`);
    expect(save("tags", { tags }).tags).toHaveLength(20);
    expect(code(() => save("tags", { tags: [...tags, "t20"] }))).toBe(
      "validation_error",
    );
    const m = save("ok");
    expect(
      code(() =>
        services.memories.save("you", { id: m.id, title: "x".repeat(201) }),
      ),
    ).toBe("validation_error");
  });
});

describe("memories: list", () => {
  it("is project-scoped and newest-updated first", () => {
    const { services, save, project } = setup();
    const other = services.projects.create("you", { name: "Other" });
    const a = save("a");
    const b = save("b");
    services.memories.save("you", { project: other.id, title: "elsewhere" });
    const ids = services.memories.list(project.id).items.map((m) => m.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids)).toEqual(new Set([a.id, b.id]));
  });

  it("filters by query over title and body, treating LIKE wildcards literally", () => {
    const { services, save, project } = setup();
    save("Deploy steps", { body: "run it" });
    save("Other", { body: "contains Deploy word" });
    save("Percent", { body: "100% sure" });
    save("Nope");
    const titles = (query: string) =>
      services.memories
        .list(project.id, { query })
        .items.map((m) => m.title)
        .sort();
    expect(titles("deploy")).toEqual(["Deploy steps", "Other"]);
    expect(titles("100%")).toEqual(["Percent"]);
    expect(titles("%")).toEqual(["Percent"]);
    expect(titles("_")).toEqual([]);
  });

  it("AND-filters tags", () => {
    const { services, save, project } = setup();
    save("ab", { tags: ["a", "b"] });
    save("a", { tags: ["a"] });
    save("c", { tags: ["c"] });
    const titles = (tags: string[]) =>
      services.memories.list(project.id, { tags }).items.map((m) => m.title);
    expect(titles(["a"]).sort()).toEqual(["a", "ab"]);
    expect(titles(["a", "b"])).toEqual(["ab"]);
    expect(titles(["a", "c"])).toEqual([]);
    expect(titles(["A"])).toEqual([]);
  });

  it("pages with a keyset cursor without gaps or repeats", () => {
    const { services, save, project } = setup();
    const created = Array.from({ length: 7 }, (_, i) => save(`m${i}`).id);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = services.memories.list(project.id, { limit: 3, cursor });
      expect(page.items.length).toBeLessThanOrEqual(3);
      seen.push(...page.items.map((m) => m.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen)).toEqual(new Set(created));
    expect(
      code(() => services.memories.list(project.id, { cursor: "bad" })),
    ).toBe("validation_error");
  });

  it("hides deleted memories unless includeDeleted, which flags them", () => {
    const { services, save, project } = setup();
    const a = save("a");
    save("b");
    services.memories.delete("agent", a.id);
    expect(services.memories.list(project.id).items).toHaveLength(1);
    const all = services.memories.list(project.id, { includeDeleted: true });
    expect(all.items.map((m) => [m.title, m.deleted]).sort()).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });
});

describe("memories: search index", () => {
  it("indexes title and body on create and rewrites on update", () => {
    const { services, save, find } = setup();
    const m = save("alpha", { body: "bravo" });
    expect(find("alpha").map((r) => r.ref_id)).toEqual([m.id]);
    expect(find("bravo").map((r) => r.ref_id)).toEqual([m.id]);
    services.memories.save("you", { id: m.id, title: "charlie" });
    expect(find("alpha")).toEqual([]);
    expect(find("charlie")).toHaveLength(1);
    expect(find("bravo")).toHaveLength(1);
  });

  it("memories never leak into issue search", () => {
    const { services, save } = setup();
    save("needle");
    expect(services.search.search({ q: "needle" }).items).toEqual([]);
  });

  it("soft delete removes the row, restore re-adds it, purge keeps it gone", async () => {
    const { services, save, find } = setup();
    const m = save("alpha");
    services.memories.delete("you", m.id);
    expect(find("alpha")).toEqual([]);
    services.memories.restore("you", m.id);
    expect(find("alpha")).toHaveLength(1);
    services.memories.delete("you", m.id);
    await services.memories.purge("you", m.id);
    expect(find("alpha")).toEqual([]);
  });
});

describe("memories: delete, restore, purge", () => {
  it("a deleted memory is not_found for get, save and a second delete", () => {
    const { services, save } = setup();
    const m = save("a");
    const r = services.memories.delete("agent", m.id);
    expect(r).toMatchObject({
      type: "memory",
      id: m.id,
      title: "a",
      counts: { memories: 1 },
    });
    expect(code(() => services.memories.get(m.id))).toBe("not_found");
    expect(
      code(() => services.memories.save("you", { id: m.id, title: "x" })),
    ).toBe("not_found");
    expect(code(() => services.memories.delete("agent", m.id))).toBe(
      "not_found",
    );
  });

  it("restore brings it back and moves updatedAt; restoring a live one conflicts", () => {
    const { services, save } = setup();
    const m = save("a");
    expect(code(() => services.memories.restore("you", m.id))).toBe("conflict");
    services.memories.delete("agent", m.id);
    services.memories.restore("agent", m.id);
    const back = services.memories.get(m.id);
    expect(back.deletedAt).toBeNull();
    expect(back.updatedAt >= m.updatedAt).toBe(true);
    // a stale token conflicts after delete + restore, by design
    expect(
      code(() =>
        services.memories.save("you", {
          id: m.id,
          title: "x",
          expectedUpdatedAt: "1970-01-01T00:00:00.000Z",
        }),
      ),
    ).toBe("conflict");
  });

  it("purge needs a prior soft delete", async () => {
    const { services, save } = setup();
    const m = save("a");
    await expect(services.memories.purge("you", m.id)).rejects.toMatchObject({
      code: "conflict",
    });
    services.memories.delete("you", m.id);
    const r = await services.memories.purge("you", m.id);
    expect(r).toMatchObject({
      type: "memory",
      id: m.id,
      counts: { memories: 1 },
    });
    expect(services.trash.list().items).toEqual([]);
  });

  it("agents may purge memories even with ALLOW_AGENT_PURGE=false (ADR 0015)", async () => {
    const { services, save, db } = setup();
    const m = save("a");
    services.memories.delete("agent", m.id);
    await services.memories.purge("agent", m.id);
    expect(db.select().from(memories).all()).toEqual([]);
  });

  it("agents still cannot purge other types without ALLOW_AGENT_PURGE", async () => {
    const { services, project } = setup();
    const issue = services.issues.create("agent", {
      project: project.id,
      title: "i",
    });
    services.trash.delete("you", "issue", issue.id);
    await expect(
      services.trash.purge("agent", "issue", issue.id),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("shows up in Trash, filterable by type", () => {
    const { services, save, project } = setup();
    const m = save("Gone");
    services.memories.delete("agent", m.id);
    const { items } = services.trash.list({ type: "memory" });
    expect(items).toEqual([
      expect.objectContaining({
        type: "memory",
        id: m.id,
        label: "Gone",
        projectId: project.id,
        projectName: "P",
        deletedBy: "agent",
      }),
    ]);
  });

  it("follows a project delete: hidden in the same batch, restored with it, blocked alone", () => {
    const { services, save, project, find } = setup();
    const m = save("alpha");
    const del = services.trash.softDelete("you", "project", project.id);
    expect(del.counts).toMatchObject({ projects: 1, memories: 1 });
    expect(code(() => services.memories.get(m.id))).toBe("not_found");
    expect(find("alpha")).toEqual([]);
    expect(code(() => services.memories.restore("you", m.id))).toBe("conflict");
    services.trash.restore("you", "project", project.id);
    expect(services.memories.get(m.id).title).toBe("alpha");
    expect(find("alpha")).toHaveLength(1);
  });

  it("a project purge removes its memories", async () => {
    const { services, save, project, db } = setup();
    save("a");
    services.trash.softDelete("you", "project", project.id);
    await services.trash.purge("you", "project", project.id);
    expect(db.select().from(memories).all()).toEqual([]);
  });
});
