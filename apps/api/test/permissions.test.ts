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

  it.each(["memory", "document"])(
    "always lets `agent` purge a %s (ADR 0015)",
    (type) => {
      expect(canPurge("agent", { allowAgentPurge: false }, type)).toBe(true);
    },
  );

  it.each(["issue", "comment", "project", "milestone", "attachment"])(
    "still denies `agent` a %s when ALLOW_AGENT_PURGE=false",
    (type) => {
      expect(canPurge("agent", { allowAgentPurge: false }, type)).toBe(false);
      expect(canPurge("agent", { allowAgentPurge: true }, type)).toBe(true);
    },
  );
});
