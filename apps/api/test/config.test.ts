import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const valid = { BASE_URL: "https://omni.example.ts.net" };

describe("loadConfig", () => {
  it("applies spec defaults when only BASE_URL is set", () => {
    expect(loadConfig(valid)).toEqual({
      port: 8787,
      dataDir: "/data",
      baseUrl: "https://omni.example.ts.net",
      maxAttachmentBytes: 10485760,
      maxMcpUploadBytes: 5242880,
      defaultIssueKey: "MAT",
      allowAgentPurge: false,
      rateLimitPerMin: 120,
      logLevel: "info",
      trustProxy: true,
    });
  });

  it("parses overrides from the environment", () => {
    const config = loadConfig({
      ...valid,
      PORT: "9000",
      DATA_DIR: "/tmp/x",
      ALLOW_AGENT_PURGE: "true",
      TRUST_PROXY: "false",
      LOG_LEVEL: "debug",
    });
    expect(config).toMatchObject({
      port: 9000,
      dataDir: "/tmp/x",
      allowAgentPurge: true,
      trustProxy: false,
      logLevel: "debug",
    });
  });

  it("fails naming BASE_URL when it is missing", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/BASE_URL/);
  });

  it("fails naming BASE_URL when it is not a URL", () => {
    expect(() => loadConfig({ BASE_URL: "nope" })).toThrow(/BASE_URL/);
  });

  it("fails naming PORT when it is not a number", () => {
    expect(() => loadConfig({ ...valid, PORT: "abc" })).toThrow(/PORT/);
  });

  it("fails naming ALLOW_AGENT_PURGE when it is not a boolean", () => {
    expect(() => loadConfig({ ...valid, ALLOW_AGENT_PURGE: "maybe" })).toThrow(
      /ALLOW_AGENT_PURGE/,
    );
  });
});
