import { describe, expect, it } from "vitest";
import { canPurge } from "../src/auth/permissions.js";

describe("canPurge", () => {
  it.each([false, true])("allows `you` when ALLOW_AGENT_PURGE=%s", (allow) => {
    expect(canPurge("you", { allowAgentPurge: allow })).toBe(true);
  });

  it("denies `agent` when ALLOW_AGENT_PURGE=false", () => {
    expect(canPurge("agent", { allowAgentPurge: false })).toBe(false);
  });

  it("allows `agent` when ALLOW_AGENT_PURGE=true", () => {
    expect(canPurge("agent", { allowAgentPurge: true })).toBe(true);
  });
});
