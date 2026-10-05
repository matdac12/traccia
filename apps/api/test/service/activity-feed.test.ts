import { describe, expect, it } from "vitest";
import { code, setupServices } from "./helpers.js";

function setup() {
  const s = setupServices();
  const project = s.services.projects.create("you", { name: "P" });
  const make = (title: string) =>
    s.services.issues.create("agent", { project: project.id, title });
  return { ...s, make };
}

describe("activity feed", () => {
  it("lists newest first across issues with identifier, title and parsed data", () => {
    const { services, make } = setup();
    const a = make("Alpha");
    const b = make("Beta");
    services.issues.update("you", a.identifier, { title: "Alpha 2" });
    const { items, nextCursor } = services.activityFeed.list();
    expect(nextCursor).toBeNull();
    expect(items).toHaveLength(3);
    const first = items[0];
    expect(first).toMatchObject({
      type: "title_changed",
      actor: "you",
      identifier: a.identifier,
      title: "Alpha 2",
      data: { from: "Alpha", to: "Alpha 2" },
    });
    expect(items.map((i) => i.identifier)).toContain(b.identifier);
    const times = items.map((i) => i.createdAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  it("paginates with a cursor without repeating or skipping rows", () => {
    const { services, make } = setup();
    for (let i = 0; i < 5; i++) make(`I${i}`);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = services.activityFeed.list({ limit: 2, cursor });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it("hides activity of deleted issues until restore, and rejects a bad cursor", async () => {
    const { services, make } = setup();
    const a = make("Alpha");
    make("Beta");
    await services.trash.delete("you", "issue", a.identifier);
    expect(
      services.activityFeed.list().items.every((i) => i.title !== "Alpha"),
    ).toBe(true);
    services.trash.restore("you", "issue", a.identifier);
    expect(
      services.activityFeed.list().items.some((i) => i.title === "Alpha"),
    ).toBe(true);
    expect(code(() => services.activityFeed.list({ cursor: "e30" }))).toBe(
      "validation_error",
    );
  });
});
