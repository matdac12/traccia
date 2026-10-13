import { describe, expect, it, vi } from "vitest";
import { setupServices } from "./helpers.js";
import { compactIssues } from "../../src/mcp/tools/present.js";

describe("issue list unresolved blockers", () => {
  it("keeps the established compact MCP response shape when service rows gain summaries", () => {
    const { services, db } = setupServices();
    const project = services.projects.create("you", {
      name: "Work",
      key: "WRK",
    });
    const blocker = services.issues.create("you", {
      project: project.id,
      title: "Blocker",
    });
    const row = services.issues.create("you", {
      project: project.id,
      title: "Blocked",
      status: "todo",
    });
    services.relations.addBlocker("you", blocker.id, row.id);
    const page = services.issues.list({ status: ["todo"] });
    expect(page.items[0]?.unresolvedBlockers).toHaveLength(1);
    // The local presenter is shared by the MCP list adapter; no MCP requests are made.
    expect(compactIssues(db, page.items)).toEqual([
      {
        identifier: "WRK-2",
        title: "Blocked",
        status: "todo",
        priority: 0,
        project: "WRK",
        updatedAt: row.updatedAt,
      },
    ]);
  });

  it("keeps grouped loading within eight database reads regardless of returned row count", () => {
    const { services, sqlite } = setupServices();
    const project = services.projects.create("you", { name: "Work" });
    const blocker = services.issues.create("you", {
      project: project.id,
      title: "Blocker",
      status: "in_review",
    });
    for (let i = 0; i < 30; i++) {
      const row = services.issues.create("you", {
        project: project.id,
        title: `Row ${i}`,
        status: i % 2 ? "todo" : "backlog",
      });
      services.relations.addBlocker("you", blocker.id, row.id);
    }
    // Observe the real SQLite boundary, not service collaborators.
    const reads = vi.spyOn(sqlite, "prepare");
    try {
      const result = services.issues.listGroups({ limit: 10 });
      expect(reads.mock.calls).toHaveLength(8); // token + six status pages + one summary batch
      for (const status of ["todo", "backlog"] as const) {
        const group = result.groups.find((g) => g.status === status)!;
        expect(group.items).toHaveLength(10);
        expect(group.nextCursor).not.toBeNull();
        expect(
          group.items.every((row) => row.unresolvedBlockers.length === 1),
        ).toBe(true);
      }
      reads.mockClear();
      expect(
        services.issues.list({ status: ["todo"], limit: 10 }).items,
      ).toHaveLength(10);
      expect(reads.mock.calls).toHaveLength(2); // page + summary batch
      reads.mockClear();
      expect(services.issues.list({ status: ["done"] }).items).toEqual([]);
      expect(reads.mock.calls).toHaveLength(1); // no summary query for an empty page
    } finally {
      reads.mockRestore();
    }
  });

  it("summarizes live unresolved incoming blockers across projects without pruning detail relations", async () => {
    const { services } = setupServices();
    const project = services.projects.create("you", {
      name: "Work",
      key: "WRK",
    });
    const other = services.projects.create("you", {
      name: "Other",
      key: "OTH",
    });
    const create = (title: string, status = "todo", projectId = project.id) =>
      services.issues.create("you", { project: projectId, title, status });
    const row = create("Blocked");
    const open = create("Open", "in_review", other.id);
    const second = create("Second", "backlog");
    const done = create("Done", "done");
    const canceled = create("Canceled", "canceled");
    const deleted = create("Deleted");
    const outgoing = create("Outgoing");
    const related = create("Related");
    for (const blocker of [open, second, done, canceled, deleted]) {
      services.relations.addBlocker("you", blocker.id, row.id);
    }
    services.relations.addBlocker("you", row.id, outgoing.id);
    services.relations.addRelated("you", row.id, related.id);
    await services.trash.delete("you", "issue", deleted.id);

    const page = services.issues.list({ project: project.id, q: "Blocked" });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: row.id,
      unresolvedBlockers: [
        {
          id: open.id,
          identifier: "OTH-1",
          title: "Open",
          status: "in_review",
        },
        {
          id: second.id,
          identifier: "WRK-2",
          title: "Second",
          status: "backlog",
        },
      ],
    });
    expect(services.issues.list({ q: "Related" }).items[0]).toMatchObject({
      unresolvedBlockers: [],
    });
    const detail = services.issues.get(row.id, ["relations"]);
    expect(detail.relations.blockedBy.map((i) => i.title)).toEqual([
      "Open",
      "Second",
      "Done",
      "Canceled",
    ]);
    expect(detail.relations.blocks.map((i) => i.title)).toEqual(["Outgoing"]);
    expect(detail.relations.related.map((i) => i.title)).toEqual(["Related"]);
  });
});
