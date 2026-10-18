import { describe, expect, it } from "vitest";
import { titleSegments } from "../src/title";

const trc = { key: "TRC", projectId: "pr_1", projectDeleted: false };

describe("titleSegments", () => {
  it("turns the referenced @KEYs into chips, whatever their case", () => {
    expect(titleSegments("Review @trc today", [trc])).toEqual([
      { text: "Review " },
      trc,
      { text: " today" },
    ]);
  });

  it("leaves a key the references don't name, and an @ inside a word, as text", () => {
    expect(titleSegments("Mail bob@TRC about @CRM", [trc])).toEqual([
      { text: "Mail bob@TRC about @CRM" },
    ]);
  });

  it("needs the whole run after the @ to be the key", () => {
    expect(titleSegments("@TRCX and @TRC", [trc])).toEqual([
      { text: "@TRCX and " },
      trc,
    ]);
  });
});
