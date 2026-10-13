import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  issueGroupsSchema,
  issueSchema,
  pageOf,
} from "../../web/lib/api/schemas.js";
import { createServices } from "../src/service/index.js";
import { createToken } from "../src/service/tokens.js";
import { createTestApp } from "./helpers/test-app.js";

let dataDir: string;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "list-blockers-"));
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(dataDir, { recursive: true, force: true });
});

function setup() {
  const t = createTestApp({ DATA_DIR: dataDir });
  const services = createServices({ db: t.db, defaultIssueKey: "MAT" });
  const project = services.projects.create("you", { name: "Work", key: "WRK" });
  const other = services.projects.create("you", { name: "Other", key: "OTH" });
  const token = createToken(t.db, { name: "test", actor: "you" }).token;
  const request = async (url: string, method = "GET", body?: unknown) => {
    const response = await t.app.request(`/v1${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    return response.json();
  };
  return { ...t, services, project, other, request };
}

describe("issue list blocker response contract", () => {
  it("the global change probe notices blocker completion outside the filtered view without changing the blocked row timestamp", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    const t = setup();
    try {
      const row = t.services.issues.create("you", {
        project: t.project.id,
        title: "Blocked",
        status: "todo",
      });
      const blocker = t.services.issues.create("you", {
        project: t.other.id,
        title: "Blocker",
        status: "in_progress",
      });
      await t.request(`/issues/${row.identifier}`, "PATCH", {
        blockedBy: [blocker.identifier],
      });
      const filtered = "/issues/groups?project=WRK&status=todo";
      let view = issueGroupsSchema.parse(await t.request(filtered));
      const originalUpdatedAt = view.groups[0]!.items[0]!.updatedAt;
      expect(view.groups[0]!.items[0]!.unresolvedBlockers).toHaveLength(1);
      for (const [index, status] of ["done", "todo", "canceled"].entries()) {
        vi.setSystemTime(new Date(`2030-01-01T00:00:0${index + 1}.000Z`));
        await t.request(`/issues/${blocker.identifier}`, "PATCH", { status });
        // This is the exact unfiltered REST probe used by latestIssueChange.
        const probe = pageOf(issueSchema).parse(
          await t.request(
            `/issues?updatedAfter=${encodeURIComponent(view.syncToken)}&includeDeleted=true&orderBy=updatedAt&order=desc&limit=1`,
          ),
        );
        expect(probe.items[0]?.id).toBe(blocker.id);
        expect(probe.items[0]!.updatedAt > view.syncToken).toBe(true);
        view = issueGroupsSchema.parse(await t.request(filtered));
        expect(view.syncToken).toBe(probe.items[0]!.updatedAt);
        expect(view.groups[0]!.items[0]!.updatedAt).toBe(originalUpdatedAt);
        expect(view.groups[0]!.items[0]!.unresolvedBlockers).toHaveLength(
          status === "todo" ? 1 : 0,
        );
        const detail = await t.request(
          `/issues/${row.identifier}?include=relations`,
        );
        expect(detail.relations.blockedBy).toEqual([
          { id: blocker.id, identifier: "OTH-1", title: "Blocker", status },
        ]);
      }
      const unchanged = await t.request(
        `/issues?updatedAfter=${encodeURIComponent(view.syncToken)}&includeDeleted=true&orderBy=updatedAt&order=desc&limit=1`,
      );
      expect(unchanged.items).toEqual([]);
    } finally {
      t.sqlite.close();
    }
  });

  it("retains compact summaries through dashboard list validation while accepting older responses", async () => {
    const t = setup();
    try {
      const row = t.services.issues.create("you", {
        project: t.project.id,
        title: "Blocked",
        status: "todo",
      });
      const blocker = t.services.issues.create("you", {
        project: t.other.id,
        title: "Blocker",
        status: "in_progress",
      });
      await t.request(`/issues/${row.identifier}`, "PATCH", {
        blockedBy: [blocker.identifier],
      });
      const summary = [
        {
          id: blocker.id,
          identifier: "OTH-1",
          title: "Blocker",
          status: "in_progress",
        },
      ];
      const body = await t.request("/issues?project=WRK&status=todo&limit=1");
      expect(body.items[0].unresolvedBlockers).toEqual(summary);
      const parsed = pageOf(issueSchema).parse(body);
      expect(parsed.items[0]).toMatchObject({ unresolvedBlockers: summary });
      const grouped = issueGroupsSchema.parse(
        await t.request("/issues/groups?project=WRK&status=todo&limit=1"),
      );
      expect(grouped.groups[0]?.items[0]).toMatchObject({
        unresolvedBlockers: summary,
      });
      const { unresolvedBlockers: _summary, ...legacy } = body.items[0];
      expect(issueSchema.safeParse(legacy).success).toBe(true);
      expect(
        issueSchema.safeParse({
          ...legacy,
          unresolvedBlockers: [{ ...summary[0], status: "unknown" }],
        }).success,
      ).toBe(false);
    } finally {
      t.sqlite.close();
    }
  });
});
