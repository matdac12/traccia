import { describe, expect, it } from "vitest";
import { titleSegments } from "../lib/personal/title";

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
});
