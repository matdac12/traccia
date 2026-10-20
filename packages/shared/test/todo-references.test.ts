import { describe, expect, it } from "vitest";
import { keyCandidatesIn, projectKeysIn, referencesIn, titleSegments } from "../src/todo-references.js";

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

const ref = (key: string, projectDeleted = false) => ({ key, projectId: `p_${key}`, projectDeleted });

describe("titleSegments", () => {
  it("turns each referenced @KEY into a chip, case-insensitively, and leaves the rest as text", () => {
    expect(titleSegments("Work on @crm UI, then @TRC", [ref("CRM"), ref("TRC")])).toEqual([
      { text: "Work on " },
      { key: "CRM", projectId: "p_CRM", projectDeleted: false },
      { text: " UI, then " },
      { key: "TRC", projectId: "p_TRC", projectDeleted: false },
    ]);
  });

  it("keeps unknown keys, e-mail addresses and over-long runs as plain text", () => {
    const refs = [ref("CRM")];
    expect(titleSegments("Check @CMR export", refs)).toEqual([{ text: "Check @CMR export" }]);
    expect(titleSegments("Mail bob@crm.com", refs)).toEqual([{ text: "Mail bob@crm.com" }]);
    expect(titleSegments("@CRMABCDEF", refs)).toEqual([{ text: "@CRMABCDEF" }]);
  });

  it("marks a chip whose Project is deleted, and finds keys after punctuation", () => {
    expect(titleSegments("(@old)", [ref("OLD", true)])).toEqual([{ text: "(" }, { key: "OLD", projectId: "p_OLD", projectDeleted: true }, { text: ")" }]);
  });

  it("links a key that names several Projects to the first one the API lists", () => {
    const refs = [{ key: "MAT", projectId: "p_one", projectDeleted: false }, { key: "MAT", projectId: "p_two", projectDeleted: false }];
    expect(titleSegments("Plan @mat", refs)).toEqual([{ text: "Plan " }, { key: "MAT", projectId: "p_one", projectDeleted: false }]);
  });

  it("needs the whole run after the @ to be the key", () => {
    expect(titleSegments("@CRMX and @CRM", [ref("CRM")])).toEqual([{ text: "@CRMX and " }, { key: "CRM", projectId: "p_CRM", projectDeleted: false }]);
  });
});
