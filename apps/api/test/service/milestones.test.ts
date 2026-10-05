import { ServiceError } from "@traccia/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { code, setupServices } from "./helpers.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T10:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

function setup() {
  const s = setupServices();
  const project = s.services.projects.create("you", { name: "P" });
  return { ...s, project };
}

describe("milestones", () => {
  it("creates with defaults and stamps actor and timestamps", () => {
    const { services, project } = setup();
    const m = services.milestones.create("agent", project.id, { name: "M1" });
    expect(m).toMatchObject({
      projectId: project.id,
      name: "M1",
      description: "",
      targetDate: null,
      sortOrder: 0,
      createdBy: "agent",
      createdAt: "2026-10-04T10:00:00.000Z",
      updatedAt: "2026-10-04T10:00:00.000Z",
    });
  });

  it("accepts a project name as reference and a valid date", () => {
    const { services, project } = setup();
    const m = services.milestones.create("you", "P", {
      name: "M",
      targetDate: "2026-12-31",
      sortOrder: 1.5,
    });
    expect(m).toMatchObject({
      projectId: project.id,
      targetDate: "2026-12-31",
      sortOrder: 1.5,
    });
  });

  it("validates the date format and calendar validity", () => {
    const { services, project } = setup();
    for (const targetDate of [
      "2026-1-1",
      "31/12/2026",
      "2026-02-30",
      "2026-13-01",
      "2026-12-31T00:00:00Z",
    ]) {
      expect(
        code(() =>
          services.milestones.create("you", project.id, {
            name: "M",
            targetDate,
          }),
        ),
      ).toBe("validation_error");
    }
    expect(
      code(() => services.milestones.create("you", project.id, { name: "" })),
    ).toBe("validation_error");
  });

  it("requires an existing, non-deleted project", () => {
    const { services, sqlite, project } = setup();
    expect(
      code(() => services.milestones.create("you", "nope", { name: "M" })),
    ).toBe("not_found");
    sqlite
      .prepare("UPDATE projects SET deleted_at = 'x' WHERE id = ?")
      .run(project.id);
    expect(
      code(() => services.milestones.create("you", project.id, { name: "M" })),
    ).toBe("not_found");
  });

  it("updates fields, can clear the date, and bumps updated_at", () => {
    const { services, project } = setup();
    const m = services.milestones.create("you", project.id, {
      name: "M",
      targetDate: "2026-12-31",
    });
    vi.setSystemTime(new Date("2026-10-04T12:00:00.000Z"));
    const u = services.milestones.update(m.id, {
      name: "M2",
      description: "d",
      sortOrder: 3,
      targetDate: null,
    });
    expect(u).toMatchObject({
      name: "M2",
      description: "d",
      sortOrder: 3,
      targetDate: null,
      createdAt: "2026-10-04T10:00:00.000Z",
      updatedAt: "2026-10-04T12:00:00.000Z",
    });
    expect(services.milestones.get(m.id)).toEqual(u);
  });

  it("rejects a stale update with conflict and leaves the row unchanged", () => {
    const { services, project } = setup();
    const m = services.milestones.create("you", project.id, { name: "M" });
    expect(
      code(() =>
        services.milestones.update(m.id, {
          name: "X",
          expectedUpdatedAt: "1999-01-01T00:00:00.000Z",
        }),
      ),
    ).toBe("conflict");
    expect(services.milestones.get(m.id)).toEqual(m);
    expect(
      services.milestones.update(m.id, {
        name: "X",
        expectedUpdatedAt: m.updatedAt,
      }).name,
    ).toBe("X");
    expect(
      code(() =>
        services.milestones.update(m.id, { expectedUpdatedAt: m.updatedAt }),
      ),
    ).toBe("validation_error");
  });

  it("update validates date and rejects empty patch / unknown id", () => {
    const { services, project } = setup();
    const m = services.milestones.create("you", project.id, { name: "M" });
    expect(
      code(() => services.milestones.update(m.id, { targetDate: "soon" })),
    ).toBe("validation_error");
    expect(code(() => services.milestones.update(m.id, {}))).toBe(
      "validation_error",
    );
    expect(code(() => services.milestones.update("zzz", { name: "x" }))).toBe(
      "not_found",
    );
    expect(code(() => services.milestones.get("zzz"))).toBe("not_found");
  });

  it("lists per project ordered by sort_order, excluding deleted by default", () => {
    const { services, sqlite, project } = setup();
    const other = services.projects.create("you", { name: "Other" });
    const b = services.milestones.create("you", project.id, {
      name: "B",
      sortOrder: 2,
    });
    const a = services.milestones.create("you", project.id, {
      name: "A",
      sortOrder: 1,
    });
    const gone = services.milestones.create("you", project.id, {
      name: "Gone",
      sortOrder: 3,
    });
    services.milestones.create("you", other.id, { name: "Elsewhere" });
    sqlite
      .prepare("UPDATE milestones SET deleted_at = 'x' WHERE id = ?")
      .run(gone.id);

    expect(services.milestones.list(project.id).map((m) => m.id)).toEqual([
      a.id,
      b.id,
    ]);
    expect(
      services.milestones
        .list(project.id, { includeDeleted: true })
        .map((m) => m.id),
    ).toEqual([a.id, b.id, gone.id]);
  });

  it("get hides a soft-deleted milestone", () => {
    const { services, sqlite, project } = setup();
    const m = services.milestones.create("you", project.id, { name: "M" });
    sqlite
      .prepare("UPDATE milestones SET deleted_at = 'x' WHERE id = ?")
      .run(m.id);
    expect(code(() => services.milestones.get(m.id))).toBe("not_found");
  });
});

describe("milestones of a deleted project", () => {
  it("are not gettable or updatable", () => {
    const { services, sqlite, project } = setup();
    const m = services.milestones.create("you", project.id, { name: "M" });
    sqlite
      .prepare("UPDATE projects SET deleted_at = 'x' WHERE id = ?")
      .run(project.id);
    expect(code(() => services.milestones.get(m.id))).toBe("not_found");
    expect(code(() => services.milestones.update(m.id, { name: "n" }))).toBe(
      "not_found",
    );
  });
});
