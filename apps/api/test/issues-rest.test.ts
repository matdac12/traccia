import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServices } from "../src/service/index.js";
import { createToken } from "../src/service/tokens.js";
import { createTestApp } from "./helpers/test-app.js";

let dataDir: string;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "issues-rest-"));
});
afterEach(() => rm(dataDir, { recursive: true, force: true }));

type Who = "agent" | "you" | "none";

function setup() {
  const t = createTestApp({ DATA_DIR: dataDir });
  const services = createServices({ db: t.db, defaultIssueKey: "MAT" });
  const project = services.projects.create("you", { name: "P" });
  const tokens = {
    agent: createToken(t.db, { name: "a", actor: "agent" }).token,
    you: createToken(t.db, { name: "y", actor: "you" }).token,
  };
  const call = async (
    method: string,
    url: string,
    opts: { who?: Who; body?: unknown; headers?: Record<string, string> } = {},
  ) => {
    const who = opts.who ?? "agent";
    const res = await t.app.request(`/v1${url}`, {
      method,
      headers: {
        ...(who === "none" ? {} : { Authorization: `Bearer ${tokens[who]}` }),
        ...(opts.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...opts.headers,
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };
  const mk = async (title: string, extra: object = {}, who: Who = "agent") => {
    const r = await call("POST", "/issues", {
      who,
      body: { project: project.id, title, ...extra },
    });
    expect(r.status).toBe(201);
    return r.json;
  };
  return { ...t, services, project, call, mk };
}

describe("auth, 404 and validation", () => {
  it("rejects every route without a token", async () => {
    const t = setup();
    for (const [m, u] of [
      ["GET", "/issues"],
      ["POST", "/issues"],
      ["GET", "/issues/MAT-1"],
      ["PATCH", "/issues/MAT-1"],
      ["DELETE", "/issues/MAT-1"],
      ["POST", "/issues/MAT-1/restore"],
      ["PATCH", "/issues/MAT-1/position"],
      ["GET", "/issues/MAT-1/comments"],
      ["POST", "/issues/MAT-1/comments"],
      ["PATCH", "/comments/x"],
      ["DELETE", "/comments/x"],
      ["GET", "/search?q=a"],
      ["GET", "/activity"],
      ["GET", "/trash"],
    ] as const) {
      const r = await t.call(m, u, { who: "none" });
      expect(r.status, `${m} ${u}`).toBe(401);
    }
  });

  it("returns 404 for unknown issues and comments", async () => {
    const t = setup();
    const body = { body: "x" };
    for (const [m, u, b] of [
      ["GET", "/issues/MAT-99", undefined],
      ["PATCH", "/issues/MAT-99", { title: "x" }],
      ["DELETE", "/issues/MAT-99", undefined],
      ["POST", "/issues/MAT-99/restore", undefined],
      ["PATCH", "/issues/MAT-99/position", { status: "todo" }],
      ["GET", "/issues/MAT-99/comments", undefined],
      ["POST", "/issues/MAT-99/comments", body],
      ["PATCH", "/comments/nope", body],
      ["DELETE", "/comments/nope", undefined],
    ] as const) {
      const r = await t.call(m, u, { body: b });
      expect(r.status, `${m} ${u}`).toBe(404);
      expect(r.json.error.code).toBe("not_found");
    }
  });

  it("returns 400 validation errors for bad bodies and queries", async () => {
    const t = setup();
    const issue = await t.mk("Real");
    const cases: Array<[string, string, unknown?]> = [
      ["POST", "/issues", { title: "" }],
      ["POST", "/issues", { project: t.project.id }],
      ["PATCH", `/issues/${issue.identifier}`, { priority: 9 }],
      ["PATCH", `/issues/${issue.identifier}/position`, { status: "nope" }],
      ["POST", `/issues/${issue.identifier}/comments`, { body: "  " }],
      ["GET", "/issues?status=nope"],
      ["GET", "/issues?limit=0"],
      ["GET", "/issues?cursor=%25%25"],
      ["GET", `/issues/${issue.identifier}?include=bogus`],
      ["GET", "/search"],
      ["GET", "/activity?limit=x"],
      ["GET", "/trash?type=bogus"],
      ["DELETE", `/issues/${issue.identifier}?purge=maybe`],
    ];
    for (const [m, u, body] of cases) {
      const r = await t.call(m, u, { body });
      expect(r.status, `${m} ${u}`).toBe(400);
      expect(r.json.error.code).toBe("validation_error");
    }
    const raw = await t.app.request(`/v1/issues/${issue.identifier}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer x`,
        "Content-Type": "application/json",
      },
      body: "{",
    });
    expect(raw.status).toBe(401);
  });
});

describe("issues", () => {
  it("creates with the token's actor, reads by identifier and ULID, lists with filters", async () => {
    const t = setup();
    const a = await t.mk("Alpha", { priority: "high" }, "you");
    const b = await t.mk("Beta");
    expect(a).toMatchObject({ createdBy: "you", priority: 2, labels: [] });
    expect(b.createdBy).toBe("agent");

    const byId = await t.call("GET", `/issues/${a.identifier.toLowerCase()}`);
    expect(byId.json.id).toBe(a.id);
    expect((await t.call("GET", `/issues/${a.id}`)).json.id).toBe(a.id);

    const list = await t.call("GET", "/issues?orderBy=createdAt&order=asc");
    expect(list.json.items.map((i: any) => i.title)).toEqual(["Alpha", "Beta"]);
    expect(list.json.nextCursor).toBeNull();
    const page = await t.call(
      "GET",
      "/issues?limit=1&orderBy=createdAt&order=asc",
    );
    expect(page.json.items).toHaveLength(1);
    const next = await t.call(
      "GET",
      `/issues?limit=1&orderBy=createdAt&order=asc&cursor=${page.json.nextCursor}`,
    );
    expect(next.json.items[0].title).toBe("Beta");
    expect(
      (await t.call("GET", "/issues?priority=high")).json.items.map(
        (i: any) => i.title,
      ),
    ).toEqual(["Alpha"]);
    expect(
      (await t.call("GET", "/issues?q=Beta")).json.items.map(
        (i: any) => i.title,
      ),
    ).toEqual(["Beta"]);
    expect(
      (await t.call("GET", "/issues?status=done&status=todo")).json.items,
    ).toEqual([]);
  });

  it("PATCH stamps the actor on activity and handles labels, blockers, parent, milestone and project move", async () => {
    const t = setup();
    t.services.labels.create({ name: "bug" });
    const milestone = t.services.milestones.create("you", t.project.id, {
      name: "M1",
    });
    const other = t.services.projects.create("you", { name: "Q" });
    const a = await t.mk("A");
    const b = await t.mk("B");
    const c = await t.mk("C");

    const r = await t.call("PATCH", `/issues/${a.identifier}`, {
      who: "you",
      body: {
        title: "A2",
        status: "in_progress",
        labels: ["bug"],
        blockedBy: [b.identifier],
        blocks: [c.identifier],
        parentId: b.identifier,
        milestoneId: milestone.id,
      },
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      title: "A2",
      status: "in_progress",
      parentId: b.id,
      milestoneId: milestone.id,
    });
    expect(r.json.labels.map((l: any) => l.name)).toEqual(["bug"]);

    const full = await t.call(
      "GET",
      `/issues/${a.identifier}?include=activity,relations`,
    );
    expect(full.json.relations.blockedBy.map((x: any) => x.identifier)).toEqual(
      [b.identifier],
    );
    expect(full.json.relations.blocks.map((x: any) => x.identifier)).toEqual([
      c.identifier,
    ]);
    const patched = full.json.activity.filter(
      (x: any) => x.type !== "issue_created",
    );
    expect(patched.length).toBeGreaterThan(3);
    expect(patched.every((x: any) => x.actor === "you")).toBe(true);

    // replace semantics: an empty list clears the blockers
    const cleared = await t.call("PATCH", `/issues/${a.identifier}`, {
      body: { blockedBy: [], blocks: [] },
    });
    expect(cleared.status).toBe(200);
    const rel = await t.call(
      "GET",
      `/issues/${a.identifier}?include=relations`,
    );
    expect(rel.json.relations).toEqual({ blockedBy: [], blocks: [], related: [] });

    // project move through PATCH keeps the identifier
    const lone = await t.mk("Lone");
    const moved = await t.call("PATCH", `/issues/${lone.identifier}`, {
      body: { project: other.id },
    });
    expect(moved.status).toBe(200);
    expect(moved.json).toMatchObject({
      projectId: other.id,
      identifier: lone.identifier,
    });
  });

  it("a failed blocker change rolls the whole PATCH back", async () => {
    const t = setup();
    const a = await t.mk("A");
    const r = await t.call("PATCH", `/issues/${a.identifier}`, {
      body: { title: "changed", blockedBy: [a.identifier] },
    });
    expect(r.status).toBe(400);
    expect((await t.call("GET", `/issues/${a.identifier}`)).json.title).toBe(
      "A",
    );
  });

  it("sets symmetric related links, shown on both issues, and replaces them wholesale", async () => {
    const t = setup();
    const a = await t.mk("A");
    const b = await t.mk("B");
    const c = await t.mk("C");
    const r = await t.call("PATCH", `/issues/${a.identifier}`, {
      body: { related: [b.identifier, c.identifier] },
    });
    expect(r.status).toBe(200);

    const fromA = await t.call(
      "GET",
      `/issues/${a.identifier}?include=relations`,
    );
    expect(fromA.json.relations.related.map((x: any) => x.identifier)).toEqual([
      b.identifier,
      c.identifier,
    ]);
    const fromB = await t.call(
      "GET",
      `/issues/${b.identifier}?include=relations`,
    );
    expect(fromB.json.relations.related.map((x: any) => x.identifier)).toEqual([
      a.identifier,
    ]);

    // replace semantics: dropping B leaves B with no related issues.
    await t.call("PATCH", `/issues/${a.identifier}`, {
      body: { related: [c.identifier] },
    });
    const afterB = await t.call(
      "GET",
      `/issues/${b.identifier}?include=relations`,
    );
    expect(afterB.json.relations.related).toEqual([]);
    const afterA = await t.call(
      "GET",
      `/issues/${a.identifier}?include=relations`,
    );
    expect(afterA.json.relations.related.map((x: any) => x.identifier)).toEqual(
      [c.identifier],
    );
  });

  it("rejects a self related link and rolls the PATCH back", async () => {
    const t = setup();
    const a = await t.mk("A");
    const r = await t.call("PATCH", `/issues/${a.identifier}`, {
      body: { title: "changed", related: [a.identifier] },
    });
    expect(r.status).toBe(400);
    expect((await t.call("GET", `/issues/${a.identifier}`)).json.title).toBe(
      "A",
    );
  });

  it("If-Match: stale -> 409 and no change; correct -> 200; body field works too", async () => {
    const t = setup();
    const a = await t.mk("A");
    const stale = await t.call("PATCH", `/issues/${a.identifier}`, {
      body: { title: "nope" },
      headers: { "If-Match": '"2020-01-01T00:00:00.000Z"' },
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("conflict");
    expect(stale.json.error.details.currentUpdatedAt).toBe(a.updatedAt);
    expect((await t.call("GET", `/issues/${a.identifier}`)).json.title).toBe(
      "A",
    );

    const ok = await t.call("PATCH", `/issues/${a.identifier}`, {
      body: { title: "yes" },
      headers: { "If-Match": a.updatedAt },
    });
    expect(ok.status).toBe(200);
    expect(ok.json.title).toBe("yes");

    const body = await t.call("PATCH", `/issues/${a.identifier}`, {
      body: { title: "again", expectedUpdatedAt: a.updatedAt },
    });
    expect(body.status).toBe(409);
  });

  it("include returns exactly the requested sections", async () => {
    const t = setup();
    const a = await t.mk("A");
    const child = await t.mk("Child", { parentId: a.identifier });
    await t.call("POST", `/issues/${a.identifier}/comments`, {
      body: { body: "hi" },
    });

    const bare = await t.call("GET", `/issues/${a.identifier}`);
    for (const k of [
      "comments",
      "activity",
      "attachments",
      "children",
      "relations",
    ]) {
      expect(bare.json, k).not.toHaveProperty(k);
    }
    expect(bare.json.labels).toEqual([]);

    const some = await t.call(
      "GET",
      `/issues/${a.identifier}?include=comments,children`,
    );
    expect(Object.keys(some.json)).toEqual(
      expect.arrayContaining(["comments", "children"]),
    );
    expect(some.json).not.toHaveProperty("activity");
    expect(some.json.comments[0].body).toBe("hi");
    expect(some.json.children.map((x: any) => x.id)).toEqual([child.id]);

    const all = await t.call(
      "GET",
      `/issues/${a.identifier}?include=comments&include=activity,attachments,children,relations`,
    );
    for (const k of [
      "comments",
      "activity",
      "attachments",
      "children",
      "relations",
    ]) {
      expect(all.json, k).toHaveProperty(k);
    }
  });

  it("moves position within and across columns", async () => {
    const t = setup();
    const a = await t.mk("A", { status: "todo" });
    const b = await t.mk("B", { status: "todo" });
    const c = await t.mk("C", { status: "backlog" });
    const r = await t.call("PATCH", `/issues/${b.identifier}/position`, {
      who: "you",
      body: { status: "todo", beforeId: a.identifier },
    });
    expect(r.status).toBe(200);
    const col = await t.call(
      "GET",
      "/issues?status=todo&orderBy=sortOrder&order=asc",
    );
    expect(col.json.items.map((i: any) => i.title)).toEqual(["B", "A"]);

    const cross = await t.call("PATCH", `/issues/${c.identifier}/position`, {
      body: { status: "todo", afterId: a.identifier },
    });
    expect(cross.json.status).toBe("todo");
    const act = await t.call("GET", `/issues/${c.identifier}?include=activity`);
    expect(act.json.activity.at(-1)).toMatchObject({
      type: "status_changed",
      actor: "agent",
    });

    const bad = await t.call("PATCH", `/issues/${a.identifier}/position`, {
      body: { status: "done", beforeId: a.identifier },
    });
    expect(bad.status).toBe(400);
  });
});

describe("optimistic concurrency (If-Match / expectedUpdatedAt)", () => {
  const STALE = '"1999-01-01T00:00:00.000Z"';

  it("position: stale If-Match or body value is 409 and the issue is unchanged", async () => {
    const t = setup();
    const a = await t.mk("A", { status: "todo" });
    const stale = await t.call("PATCH", `/issues/${a.identifier}/position`, {
      who: "you",
      body: { status: "done" },
      headers: { "If-Match": STALE },
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error.details.currentUpdatedAt).toBe(a.updatedAt);
    const staleBody = await t.call(
      "PATCH",
      `/issues/${a.identifier}/position`,
      {
        who: "you",
        body: { status: "done", expectedUpdatedAt: "1999-01-01T00:00:00.000Z" },
      },
    );
    expect(staleBody.status).toBe(409);
    const still = await t.call("GET", `/issues/${a.identifier}`);
    expect(still.json).toMatchObject({
      status: "todo",
      updatedAt: a.updatedAt,
    });
    const fresh = await t.call("PATCH", `/issues/${a.identifier}/position`, {
      who: "you",
      body: { status: "done" },
      headers: { "If-Match": `"${a.updatedAt}"` },
    });
    expect(fresh.status).toBe(200);
    expect(fresh.json.status).toBe("done");
  });

  it("project PATCH: stale is 409 with the row unchanged; fresh succeeds", async () => {
    const t = setup();
    const before = (await t.call("GET", `/projects/${t.project.id}`)).json;
    const stale = await t.call("PATCH", `/projects/${t.project.id}`, {
      who: "you",
      body: { description: "mine" },
      headers: { "If-Match": STALE },
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error.details.currentUpdatedAt).toBe(before.updatedAt);
    expect(
      (await t.call("GET", `/projects/${t.project.id}`)).json.description,
    ).toBe(before.description);
    const fresh = await t.call("PATCH", `/projects/${t.project.id}`, {
      who: "you",
      body: { description: "mine", expectedUpdatedAt: before.updatedAt },
    });
    expect(fresh.status).toBe(200);
    expect(fresh.json.description).toBe("mine");
  });

  it("milestone PATCH: stale is 409 with the row unchanged; fresh succeeds", async () => {
    const t = setup();
    const m = t.services.milestones.create("you", t.project.id, { name: "M" });
    const stale = await t.call("PATCH", `/milestones/${m.id}`, {
      who: "you",
      body: { name: "X" },
      headers: { "If-Match": STALE },
    });
    expect(stale.status).toBe(409);
    expect((await t.call("GET", `/milestones/${m.id}`)).json.name).toBe("M");
    const fresh = await t.call("PATCH", `/milestones/${m.id}`, {
      who: "you",
      body: { name: "X" },
      headers: { "If-Match": `"${m.updatedAt}"` },
    });
    expect(fresh.status).toBe(200);
    expect(fresh.json.name).toBe("X");
  });
});

describe("comments", () => {
  it("creates (stamping actor), lists threads, edits own, forbids others, deletes", async () => {
    const t = setup();
    const a = await t.mk("A");
    const created = await t.call("POST", `/issues/${a.identifier}/comments`, {
      body: { body: "first" },
    });
    expect(created.status).toBe(201);
    expect(created.json.actor).toBe("agent");
    const reply = await t.call("POST", `/issues/${a.identifier}/comments`, {
      who: "you",
      body: { body: "re", parentId: created.json.id },
    });
    expect(reply.json).toMatchObject({
      actor: "you",
      parentId: created.json.id,
    });

    const list = await t.call("GET", `/issues/${a.identifier}/comments`);
    expect(list.json.items[0].replies[0].id).toBe(reply.json.id);

    const foreign = await t.call("PATCH", `/comments/${created.json.id}`, {
      who: "you",
      body: { body: "hijack" },
    });
    expect(foreign.status).toBe(403);
    expect(foreign.json.error.code).toBe("forbidden");
    const own = await t.call("PATCH", `/comments/${created.json.id}`, {
      body: { body: "edited" },
    });
    expect(own.status).toBe(200);
    expect(own.json.body).toBe("edited");

    const del = await t.call("DELETE", `/comments/${created.json.id}`);
    expect(del.status).toBe(200);
    expect(del.json).toMatchObject({ type: "comment", purged: false });
    expect(
      (await t.call("GET", `/issues/${a.identifier}/comments`)).json.items,
    ).toEqual([]);
    expect(
      (
        await t.call("PATCH", `/comments/${created.json.id}`, {
          body: { body: "x" },
        })
      ).status,
    ).toBe(404);
  });
});

describe("search, activity and trash", () => {
  it("searches with snippets, optionally scoped to a project", async () => {
    const t = setup();
    const a = await t.mk("Zebra crossing", { description: "stripes" });
    await t.call("POST", `/issues/${a.identifier}/comments`, {
      body: { body: "giraffe note" },
    });
    const r = await t.call("GET", "/search?q=zebra");
    expect(r.json.items).toHaveLength(1);
    expect(r.json.items[0]).toMatchObject({
      identifier: a.identifier,
      source: "issue",
    });
    const snippet = r.json.items[0].snippet as {
      text: string;
      match: boolean;
    }[];
    expect(Array.isArray(snippet)).toBe(true);
    expect(snippet.some((s) => s.match && s.text === "Zebra")).toBe(true);
    expect(JSON.stringify(snippet)).not.toContain("<mark>");
    expect(
      (await t.call("GET", "/search?q=giraffe")).json.items[0].source,
    ).toBe("comment");
    expect(
      (await t.call("GET", `/search?q=zebra&project=${t.project.id}`)).json
        .items,
    ).toHaveLength(1);
    const q = t.services.projects.create("you", { name: "Q" });
    expect(
      (await t.call("GET", `/search?q=zebra&project=${q.id}`)).json.items,
    ).toEqual([]);
    expect((await t.call("GET", "/search?q=")).json.items).toEqual([]);
  });

  it("prefix-matches a partial last word and returns a safe snippet structure", async () => {
    const t = setup();
    const a = await t.mk("Spiegare perché", {
      description: "body with <script>alert(1)</script>",
    });
    const partial = await t.call("GET", "/search?q=perch");
    expect(
      partial.json.items.map((i: { identifier: string }) => i.identifier),
    ).toEqual([a.identifier]);
    const snippet = partial.json.items[0].snippet as {
      text: string;
      match: boolean;
    }[];
    expect(Array.isArray(snippet)).toBe(true);
    expect(snippet.some((s) => s.match)).toBe(true);
    expect(JSON.stringify(partial.json)).not.toContain("<mark>");
  });

  it("serves the activity feed newest first with identifier and title, paginated", async () => {
    const t = setup();
    const a = await t.mk("A", {}, "you");
    await t.call("PATCH", `/issues/${a.identifier}`, { body: { title: "A2" } });
    const feed = await t.call("GET", "/activity");
    expect(feed.json.items[0]).toMatchObject({
      type: "title_changed",
      actor: "agent",
      identifier: a.identifier,
      title: "A2",
      data: { from: "A", to: "A2" },
    });
    expect(feed.json.items[1]).toMatchObject({
      type: "issue_created",
      actor: "you",
    });
    const p1 = await t.call("GET", "/activity?limit=1");
    expect(p1.json.nextCursor).toEqual(expect.any(String));
    const p2 = await t.call(
      "GET",
      `/activity?limit=1&cursor=${p1.json.nextCursor}`,
    );
    expect(p2.json.items[0].type).toBe("issue_created");
    expect(p2.json.nextCursor).toBeNull();
  });

  it("filters the activity feed by project and 404s on an unknown one", async () => {
    const t = setup();
    const a = await t.mk("A");
    const q = t.services.projects.create("you", { name: "Q" });
    t.services.issues.create("agent", { project: q.id, title: "Elsewhere" });
    const feed = await t.call("GET", `/activity?project=${t.project.id}`);
    expect(feed.status).toBe(200);
    expect(
      feed.json.items.map((i: { identifier: string }) => i.identifier),
    ).toEqual([a.identifier]);
    expect((await t.call("GET", "/activity?project=nope")).status).toBe(404);
    expect((await t.call("GET", "/activity?project=")).status).toBe(400);
  });

  it("purge: agent forbidden by default, needs a prior delete; you may purge", async () => {
    const t = setup();
    const a = await t.mk("A");
    expect(
      (
        await t.call("DELETE", `/issues/${a.identifier}?purge=true`, {
          who: "you",
        })
      ).status,
    ).toBe(409);
    expect((await t.call("DELETE", `/issues/${a.identifier}`)).status).toBe(
      200,
    );
    const denied = await t.call("DELETE", `/issues/${a.identifier}?purge=true`);
    expect(denied.status).toBe(403);
    const ok = await t.call("DELETE", `/issues/${a.identifier}?purge=true`, {
      who: "you",
    });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ type: "issue", purged: true });
    expect(
      (await t.call("POST", `/issues/${a.identifier}/restore`)).status,
    ).toBe(404);
  });
});

describe("full scenario over HTTP", () => {
  it("create issue -> labels -> blocker -> comment -> move -> search -> delete -> trash -> restore", async () => {
    const t = setup();
    t.services.labels.create({ name: "bug" });
    const blocker = await t.mk("Fix the build");
    const issue = await t.mk(
      "Login page broken",
      { description: "500 on submit" },
      "you",
    );

    const patched = await t.call("PATCH", `/issues/${issue.identifier}`, {
      who: "you",
      body: { labels: ["bug"], blockedBy: [blocker.identifier] },
    });
    expect(patched.status).toBe(200);
    expect(patched.json.labels).toHaveLength(1);

    const comment = await t.call(
      "POST",
      `/issues/${issue.identifier}/comments`,
      { body: { body: "reproduced on staging" } },
    );
    expect(comment.status).toBe(201);

    const moved = await t.call(
      "PATCH",
      `/issues/${issue.identifier}/position`,
      {
        who: "you",
        body: { status: "in_progress" },
      },
    );
    expect(moved.json.status).toBe("in_progress");

    const found = await t.call("GET", "/search?q=staging");
    expect(found.json.items.map((i: any) => i.identifier)).toEqual([
      issue.identifier,
    ]);

    expect(
      (await t.call("DELETE", `/issues/${issue.identifier}`, { who: "you" }))
        .status,
    ).toBe(200);
    expect((await t.call("GET", `/issues/${issue.identifier}`)).status).toBe(
      404,
    );
    expect((await t.call("GET", "/search?q=staging")).json.items).toEqual([]);

    const trash = await t.call("GET", "/trash");
    expect(trash.json.items.map((i: any) => [i.type, i.id])).toContainEqual([
      "issue",
      issue.id,
    ]);
    expect(
      (await t.call("GET", "/trash?type=comment")).json.items.map(
        (i: any) => i.type,
      ),
    ).toEqual(["comment"]);
    expect((await t.call("GET", "/trash?type=project")).json.items).toEqual([]);

    const restored = await t.call(
      "POST",
      `/issues/${issue.identifier}/restore`,
      { who: "you" },
    );
    expect(restored.status).toBe(200);
    expect(restored.json.type).toBe("issue");
    const back = await t.call(
      "GET",
      `/issues/${issue.identifier}?include=comments,relations`,
    );
    expect(back.status).toBe(200);
    expect(back.json.comments).toHaveLength(1);
    expect(back.json.relations.blockedBy[0].identifier).toBe(
      blocker.identifier,
    );
    expect((await t.call("GET", "/trash")).json.items).toEqual([]);
    expect((await t.call("GET", "/search?q=staging")).json.items).toHaveLength(
      1,
    );
    expect(
      (await t.call("POST", `/issues/${issue.identifier}/restore`)).status,
    ).toBe(409);
  });
});

describe("PATCH blocker cycles", () => {
  it("rejects a transitive cycle and leaves the other fields unchanged", async () => {
    const t = setup();
    const a = await t.mk("A");
    const b = await t.mk("B");
    const c = await t.mk("C");
    await t.call("PATCH", `/issues/${b.identifier}`, {
      body: { blockedBy: [a.identifier] },
    });
    await t.call("PATCH", `/issues/${c.identifier}`, {
      body: { blockedBy: [b.identifier] },
    });
    const res = await t.call("PATCH", `/issues/${a.identifier}`, {
      body: { title: "Renamed", blockedBy: [c.identifier] },
    });
    expect(res.status).toBe(400);
    expect(res.json.error.message).toContain(
      `${c.identifier} -> ${a.identifier} -> ${b.identifier} -> ${c.identifier}`,
    );
    const after = await t.call("GET", `/issues/${a.identifier}`);
    expect(after.json.title).toBe("A");
  });

  it("replaces blockedBy and blocks together without a false cycle", async () => {
    const t = setup();
    const a = await t.mk("A");
    const b = await t.mk("B");
    const c = await t.mk("C");
    // A blocks B, B blocks C. Swap: A is now blocked by C and blocks nothing.
    await t.call("PATCH", `/issues/${a.identifier}`, {
      body: { blocks: [b.identifier] },
    });
    await t.call("PATCH", `/issues/${b.identifier}`, {
      body: { blocks: [c.identifier] },
    });
    const res = await t.call("PATCH", `/issues/${a.identifier}`, {
      body: { blockedBy: [c.identifier], blocks: [] },
    });
    expect(res.status).toBe(200);
  });
});

describe("GET /v1/issues/groups and projects?include=milestones", () => {
  it("returns groups with labels, per-group cursors and a syncToken", async () => {
    const { call, mk, project } = setup();
    for (let i = 0; i < 3; i++) await mk(`t${i}`, { status: "todo" });
    await mk("d", { status: "done" });
    const first = await call(
      "GET",
      "/issues/groups?limit=2&status=todo&status=done",
    );
    expect(first.status).toBe(200);
    expect(first.json.groups.map((g: any) => g.status)).toEqual([
      "todo",
      "done",
    ]);
    expect(first.json.groups[0].items[0].labels).toEqual([]);
    expect(first.json.syncToken).toEqual(expect.any(String));
    const cursor = first.json.groups[0].nextCursor;
    expect(cursor).toEqual(expect.any(String));
    const next = await call(
      "GET",
      `/issues/groups?limit=2&status=todo&cursor=todo:${cursor}&project=${project.id}`,
    );
    expect(next.json.groups).toHaveLength(1);
    expect(next.json.groups[0].items).toHaveLength(1);
    expect(next.json.groups[0].nextCursor).toBeNull();
  });

  it("rejects a malformed or unknown-status cursor and needs a token", async () => {
    const { call } = setup();
    expect((await call("GET", "/issues/groups?cursor=nope")).status).toBe(400);
    expect((await call("GET", "/issues/groups?cursor=bogus:abc")).status).toBe(
      400,
    );
    expect((await call("GET", "/issues/groups", { who: "none" })).status).toBe(
      401,
    );
  });

  it("embeds milestones with progress only when asked", async () => {
    const { call, project } = setup();
    const m = await call("POST", `/projects/${project.id}/milestones`, {
      body: { name: "Alpha" },
    });
    expect(m.status).toBe(201);
    const plain = await call("GET", "/projects");
    expect(plain.json.items[0].milestones).toBeUndefined();
    const withM = await call("GET", "/projects?include=milestones");
    expect(withM.json.items[0].milestones).toEqual([
      expect.objectContaining({ name: "Alpha", progress: expect.anything() }),
    ]);
    expect((await call("GET", "/projects?include=nope")).status).toBe(400);
  });
});
