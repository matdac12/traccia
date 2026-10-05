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
      rateLimitYouPerMin: 1200,
      logLevel: "info",
      trustProxy: true,
      sourceUrlExtraPorts: [],
      oauthExtraRedirectUris: [],
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

  it("leaves oauthPublicUrl unset by default and accepts an https URL", () => {
    expect(loadConfig(valid).oauthPublicUrl).toBeUndefined();
    expect(
      loadConfig({
        ...valid,
        OAUTH_PUBLIC_URL: "https://omni.example.ts.net:8443/",
      }).oauthPublicUrl,
    ).toBe("https://omni.example.ts.net:8443/");
  });

  it.each(["http://omni.example.ts.net:8443", "nope"])(
    "rejects OAUTH_PUBLIC_URL=%s",
    (value) => {
      expect(() => loadConfig({ ...valid, OAUTH_PUBLIC_URL: value })).toThrow(
        /OAUTH_PUBLIC_URL/,
      );
    },
  );

  it("parses SOURCE_URL_EXTRA_PORTS as a port list", () => {
    expect(
      loadConfig({ ...valid, SOURCE_URL_EXTRA_PORTS: "8443, 9443" })
        .sourceUrlExtraPorts,
    ).toEqual([8443, 9443]);
  });

  it("parses OAUTH_EXTRA_REDIRECT_URIS as a URI list", () => {
    expect(
      loadConfig({
        ...valid,
        OAUTH_EXTRA_REDIRECT_URIS: "https://a.example/cb, https://b.example/cb",
      }).oauthExtraRedirectUris,
    ).toEqual(["https://a.example/cb", "https://b.example/cb"]);
  });

  it.each(["http://a.example/cb", "https://a.example/cb#x", "nope"])(
    "rejects OAUTH_EXTRA_REDIRECT_URIS=%s",
    (value) => {
      expect(() =>
        loadConfig({ ...valid, OAUTH_EXTRA_REDIRECT_URIS: value }),
      ).toThrow(ConfigError);
    },
  );

  it.each(["abc", "0", "70000", "8443,x"])(
    "rejects SOURCE_URL_EXTRA_PORTS=%s",
    (v) => {
      expect(() => loadConfig({ ...valid, SOURCE_URL_EXTRA_PORTS: v })).toThrow(
        /SOURCE_URL_EXTRA_PORTS/,
      );
    },
  );

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
