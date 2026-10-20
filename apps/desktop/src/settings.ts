import { isTimeZone } from "@traccia/shared";
import type { ApiResult } from "./api-client";

/** Settings (docs/desktop-app.md §7). The Token itself never comes back from the Rust side. */
export type SavedSettings = {
  apiUrl: string | null;
  ownerTimezone: string;
  hasToken: boolean;
};

/** The form. A blank `token` keeps the saved one. */
export type SettingsForm = {
  apiUrl: string;
  token: string;
  ownerTimezone: string;
};

export type SettingsErrors = Partial<Record<keyof SettingsForm, string>>;

/** Matches the API's `OWNER_TIMEZONE` default. */
export const DEFAULT_TIMEZONE = "Europe/Rome";

/** A fresh install: nothing saved yet. */
export const FRESH_SETTINGS: SavedSettings = {
  apiUrl: null,
  ownerTimezone: DEFAULT_TIMEZONE,
  hasToken: false,
};

/**
 * An IANA zone, or a fixed offset like `+01:00`. The shared `isTimeZone` refuses offsets, but earlier versions of this
 * form saved them, so a saved offset keeps working.
 */
export function isValidTimezone(name: string): boolean {
  const zone = name.trim();
  return isTimeZone(zone) || isOffset(zone);
}

function isOffset(zone: string): boolean {
  if (!/^[+-]\d{2}(:?\d{2})?$/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function isApiUrl(input: string): boolean {
  try {
    const url = new URL(input.trim());
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.hostname !== ""
    );
  } catch {
    return false;
  }
}

export function validateSettings(
  form: SettingsForm,
  hasToken: boolean,
): SettingsErrors {
  const errors: SettingsErrors = {};
  if (!isApiUrl(form.apiUrl)) {
    errors.apiUrl = "Enter the API URL, starting with https://";
  }
  if (!form.token.trim() && !hasToken) {
    errors.token = "Paste a Token with the todos scope.";
  }
  if (!isValidTimezone(form.ownerTimezone)) {
    errors.ownerTimezone =
      "Not a timezone. Use an IANA name, like Europe/Rome.";
  }
  return errors;
}

/** The line under "Test connection". */
export function describeConnectionTest(result: ApiResult<unknown>): {
  ok: boolean;
  message: string;
} {
  if (result.ok)
    return { ok: true, message: "OK. Traccia accepted the Token." };
  const failure = result.failure;
  switch (failure.kind) {
    case "refused":
      return {
        ok: false,
        message: `Traccia refused the Token (${failure.status}${failure.apiMessage ? `: ${failure.apiMessage}` : ""}).`,
      };
    case "offline":
      return { ok: false, message: `Can't reach Traccia (${failure.reason}).` };
    case "error":
      return {
        ok: false,
        message: `Traccia answered ${failure.status}: ${failure.message}`,
      };
    case "notConfigured":
    case "invalid":
      return { ok: false, message: failure.message };
  }
}
