import { describe, expect, it } from "vitest";
import { keyCandidatesIn, projectKeysIn, referencesIn } from "../src/todo-references.js";

describe("keyCandidatesIn", () => {
  it("finds each @ run not preceded by a letter or digit, with its place in the title", () => {
    expect(keyCandidatesIn("Call @crm, (@TRC) and x,@web")).toEqual([
      { key: "CRM", index: 5, end: 9 },
      { key: "TRC", index: 12, end: 16 },
      { key: "WEB", index: 24, end: 28 },
    ]);
  });

  it("takes the whole run, and skips an e-mail address", () => {
    expect(keyCandidatesIn("@ABCDEFGHI")).toEqual([{ key: "ABCDEFGHI", index: 0, end: 10 }]);
    expect(keyCandidatesIn("bob@crm.com")).toEqual([]);
  });
});

describe("projectKeysIn", () => {
  it("lists valid keys uppercased, in order and without duplicates", () => {
    expect(projectKeysIn("@crm and @TRC and @Crm")).toEqual(["CRM", "TRC"]);
  });

  it("leaves out runs that are no Project key rather than cutting them short", () => {
    expect(projectKeysIn("@ABCDEFGHI @1AB @a")).toEqual([]);
  });
});

describe("referencesIn", () => {
  const live = [
    { id: "p1", key: "CRM" },
    { id: "p2", key: "TRC" },
  ];
  const old = { key: "OLD", projectId: "p9", projectDeleted: true };

  it("names the Projects the title mentions, then the kept references it still mentions", () => {
    expect(referencesIn("Plan @trc, @old and @nope", live, [old, { key: "GONE", projectId: "p8", projectDeleted: true }])).toEqual([
      { key: "TRC", projectId: "p2", projectDeleted: false },
      old,
    ]);
  });

  it("drops a kept reference a live Project of the same key replaces", () => {
    expect(referencesIn("@crm", live, [{ key: "CRM", projectId: "p0", projectDeleted: true }])).toEqual([{ key: "CRM", projectId: "p1", projectDeleted: false }]);
  });
});
