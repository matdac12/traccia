import { describe, expect, it } from "vitest";
import {
  describeConnectionTest,
  isValidTimezone,
  validateSettings,
} from "../src/settings";

describe("isValidTimezone", () => {
  it("accepts IANA names", () => {
    expect(isValidTimezone("Europe/Rome")).toBe(true);
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
  });

  it("refuses anything Intl.DateTimeFormat doesn't know", () => {
    expect(isValidTimezone("Europe/Atlantis")).toBe(false);
    expect(isValidTimezone("Rome")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});

describe("validateSettings", () => {
  const form = {
    apiUrl: "https://box.tail.ts.net",
    token: "",
    ownerTimezone: "Europe/Rome",
  };

  it("accepts a full form, and a blank Token when one is saved", () => {
    expect(validateSettings({ ...form, token: "trc_x" }, false)).toEqual({});
    expect(validateSettings(form, true)).toEqual({});
  });

  it("needs a Token on a fresh install", () => {
    expect(validateSettings(form, false)).toEqual({
      token: "Paste a Token with the todos scope.",
    });
  });

  it("needs an http(s) API URL", () => {
    for (const apiUrl of ["", "box.tail.ts.net", "ftp://box", "https://"]) {
      expect(validateSettings({ ...form, apiUrl }, true)).toEqual({
        apiUrl: "Enter the API URL, starting with https://",
      });
    }
    expect(
      validateSettings({ ...form, apiUrl: " http://127.0.0.1:8871/ " }, true),
    ).toEqual({});
  });

  it("needs a known Owner timezone", () => {
    expect(
      validateSettings({ ...form, ownerTimezone: "Mars/Olympus" }, true),
    ).toEqual({
      ownerTimezone: "Not a timezone. Use an IANA name, like Europe/Rome.",
    });
  });
});

describe("describeConnectionTest", () => {
  it("says OK when the API answered", () => {
    expect(describeConnectionTest({ ok: true, value: {} })).toEqual({
      ok: true,
      message: "OK. Traccia accepted the Token.",
    });
  });

  it("shows a refused Token with the API's own message", () => {
    expect(
      describeConnectionTest({
        ok: false,
        failure: {
          kind: "refused",
          status: 401,
          message: "Traccia refused the Token. Open Settings.",
          apiMessage: "Invalid token",
        },
      }),
    ).toEqual({
      ok: false,
      message: "Traccia refused the Token (401: Invalid token).",
    });
  });

  it("says when Traccia can't be reached", () => {
    expect(
      describeConnectionTest({
        ok: false,
        failure: { kind: "offline", reason: "could not connect" },
      }),
    ).toEqual({
      ok: false,
      message: "Can't reach Traccia (could not connect).",
    });
  });

  it("shows other API errors with their status", () => {
    expect(
      describeConnectionTest({
        ok: false,
        failure: { kind: "error", status: 500, message: "Internal error" },
      }),
    ).toEqual({ ok: false, message: "Traccia answered 500: Internal error" });
  });
});
