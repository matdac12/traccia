import type { ServiceError } from "@traccia/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceContext } from "../../src/service/context.js";
import { allocateIssueNumber } from "../../src/service/index.js";
import { code, setupServices } from "./helpers.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T10:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("projects.create", () => {
  it("uses the default key and creates its row on first use", () => {
    const { services, sqlite } = setupServices();
    const p = services.projects.create("you", { name: "Alpha" });
    expect(p).toMatchObject({
      key: "MAT",
      name: "Alpha",
      description: "",
      status: "active",
      createdBy: "you",
      createdAt: "2026-10-04T10:00:00.000Z",
      updatedAt: "2026-10-04T10:00:00.000Z",
      deletedAt: null,
    });
    expect(sqlite.prepare("SELECT key FROM issue_keys").all()).toEqual([
      { key: "MAT" },
    ]);
  });

  it("honours a configured default key", () => {
    const { services } = setupServices("BD");
    expect(services.projects.create("agent", { name: "A" }).key).toBe("BD");
  });

  it("an explicit key creates a new key row and stamps the actor", () => {
    const { services, sqlite } = setupServices();
    const p = services.projects.create("agent", { name: "Ops", key: "OPS" });
    expect(p).toMatchObject({ key: "OPS", createdBy: "agent" });
    expect(
      sqlite.prepare("SELECT key FROM issue_keys ORDER BY key").all(),
    ).toEqual([{ key: "OPS" }]);
  });

  it("reuses an existing key row for several projects", () => {
    const { services, sqlite } = setupServices();
    services.projects.create("you", { name: "A" });
    services.projects.create("you", { name: "B" });
    expect(
      sqlite.prepare("SELECT count(*) AS n FROM issue_keys").get(),
    ).toEqual({ n: 1 });
  });

  it("rejects invalid input with validation_error", () => {
    const { services } = setupServices();
    expect(code(() => services.projects.create("you", { name: "  " }))).toBe(
      "validation_error",
    );
    expect(
      code(() => services.projects.create("you", { name: "A", key: "mat" })),
    ).toBe("validation_error");
    expect(
      code(() =>
        services.projects.create("you", {
          name: "A",
          status: "nope" as "active",
        }),
      ),
    ).toBe("validation_error");
  });

  it("a misconfigured default key is rejected, not silently stored", () => {
    const { services } = setupServices("bad key");
    expect(code(() => services.projects.create("you", { name: "A" }))).toBe(
      "validation_error",
    );
  });
});

describe("projects.get lookup rules", () => {
  it("resolves by id, by exact name, and by key when unique", () => {
    const { services } = setupServices();
    const a = services.projects.create("you", { name: "Alpha" });
    expect(services.projects.get(a.id).id).toBe(a.id);
    expect(services.projects.get("Alpha").id).toBe(a.id);
    expect(services.projects.get("MAT").id).toBe(a.id);
  });

  it("name is case-sensitive and exact", () => {
    const { services } = setupServices();
    services.projects.create("you", { name: "Alpha" });
    expect(code(() => services.projects.get("alpha"))).toBe("not_found");
    expect(code(() => services.projects.get("Alph"))).toBe("not_found");
  });

  it("a shared key is ambiguous (conflict) but names still resolve", () => {
    const { services } = setupServices();
    const a = services.projects.create("you", { name: "Alpha" });
    services.projects.create("you", { name: "Beta" });
    expect(code(() => services.projects.get("MAT"))).toBe("conflict");
    expect(services.projects.get("Alpha").id).toBe(a.id);
  });

  it("duplicate names are ambiguous; the id still works", () => {
    const { services } = setupServices();
    const a = services.projects.create("you", { name: "Same" });
    services.projects.create("you", { name: "Same" });
    expect(code(() => services.projects.get("Same"))).toBe("conflict");
    expect(services.projects.get(a.id).id).toBe(a.id);
  });

  it("ambiguity error lists candidate ids", () => {
    const { services } = setupServices();
    const a = services.projects.create("you", { name: "A" });
    const b = services.projects.create("you", { name: "B" });
    try {
      services.projects.get("MAT");
      expect.unreachable();
    } catch (e) {
      expect((e as ServiceError).details).toEqual({
        candidates: [
          { id: a.id, name: "A" },
          { id: b.id, name: "B" },
        ],
      });
    }
  });

  it("unknown reference is not_found", () => {
    const { services } = setupServices();
    expect(code(() => services.projects.get("nope"))).toBe("not_found");
  });
});

describe("issue numbers across projects", () => {
  it("projects under one key share one counter that only grows", () => {
    const { services, db } = setupServices();
    const ctx = createServiceContext({ db, defaultIssueKey: "MAT" });
    const next = () => ctx.write((tx) => allocateIssueNumber(tx, "MAT"));
    services.projects.create("you", { name: "A" });
    const first = next();
    services.projects.create("you", { name: "B" });
    expect([first, next(), next()]).toEqual([1, 2, 3]);
  });
});

describe("projects.update expectedUpdatedAt", () => {
  it("rejects a stale update with conflict and leaves the row unchanged", () => {
    const { services } = setupServices();
    const p = services.projects.create("you", { name: "A" });
    expect(
      code(() =>
        services.projects.update(p.id, {
          name: "B",
          expectedUpdatedAt: "1999-01-01T00:00:00.000Z",
        }),
      ),
    ).toBe("conflict");
    expect(services.projects.get(p.id)).toEqual(p);
    const u = services.projects.update(p.id, {
      name: "B",
      expectedUpdatedAt: p.updatedAt,
    });
    expect(u.name).toBe("B");
  });

  it("does not count expectedUpdatedAt as a field to update", () => {
    const { services } = setupServices();
    const p = services.projects.create("you", { name: "A" });
    expect(
      code(() =>
        services.projects.update(p.id, { expectedUpdatedAt: p.updatedAt }),
      ),
    ).toBe("validation_error");
  });
});

describe("projects.update", () => {
  it("updates fields and bumps updated_at only", () => {
    const { services } = setupServices();
    const p = services.projects.create("agent", { name: "A" });
    vi.setSystemTime(new Date("2026-10-04T11:00:00.000Z"));
    const u = services.projects.update(p.id, {
      name: "B",
      description: "d",
      status: "paused",
    });
    expect(u).toMatchObject({
      name: "B",
      description: "d",
      status: "paused",
      createdBy: "agent",
      createdAt: "2026-10-04T10:00:00.000Z",
      updatedAt: "2026-10-04T11:00:00.000Z",
    });
  });

  it("accepts every project status", () => {
    const { services } = setupServices();
    const p = services.projects.create("you", { name: "A" });
    for (const status of [
      "active",
      "paused",
      "completed",
      "canceled",
    ] as const) {
      expect(services.projects.update(p.id, { status }).status).toBe(status);
    }
  });

  it("partial update leaves other fields alone", () => {
    const { services } = setupServices();
    const p = services.projects.create("you", {
      name: "A",
      description: "keep",
    });
    const u = services.projects.update("A", { status: "completed" });
    expect(u).toMatchObject({ name: "A", description: "keep" });
    expect(u.id).toBe(p.id);
  });

  it("rejects bad status, empty patch and unknown project", () => {
    const { services } = setupServices();
    const p = services.projects.create("you", { name: "A" });
    expect(
      code(() => services.projects.update(p.id, { status: "x" as "active" })),
    ).toBe("validation_error");
    expect(code(() => services.projects.update(p.id, {}))).toBe(
      "validation_error",
    );
    expect(code(() => services.projects.update("zzz", { name: "B" }))).toBe(
      "not_found",
    );
  });
});

describe("projects.list", () => {
  it("lists oldest first, filters by status, excludes deleted by default", () => {
    const { services, sqlite } = setupServices();
    const a = services.projects.create("you", { name: "A" });
    const b = services.projects.create("you", { name: "B", status: "paused" });
    const c = services.projects.create("you", { name: "C" });
    sqlite
      .prepare("UPDATE projects SET deleted_at = ? WHERE id = ?")
      .run("2026-10-04T10:00:00.000Z", c.id);

    expect(services.projects.list().map((p) => p.id)).toEqual([a.id, b.id]);
    expect(
      services.projects.list({ status: "paused" }).map((p) => p.id),
    ).toEqual([b.id]);
    expect(
      services.projects.list({ includeDeleted: true }).map((p) => p.id),
    ).toEqual([a.id, b.id, c.id]);
    expect(
      services.projects
        .list({ status: "active", includeDeleted: true })
        .map((p) => p.id),
    ).toEqual([a.id, c.id]);
  });

  it("deleted projects are hidden from get unless includeDeleted", () => {
    const { services, sqlite } = setupServices();
    const a = services.projects.create("you", { name: "A" });
    sqlite
      .prepare("UPDATE projects SET deleted_at = ? WHERE id = ?")
      .run("2026-10-04T10:00:00.000Z", a.id);
    expect(code(() => services.projects.get(a.id))).toBe("not_found");
    expect(services.projects.get(a.id, { includeDeleted: true }).id).toBe(a.id);
  });
});
