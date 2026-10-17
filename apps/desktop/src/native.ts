import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ApiOutcome, Transport } from "./api-client";
import {
  FRESH_SETTINGS,
  type SavedSettings,
  type SettingsForm,
} from "./settings";

// The Rust side (src-tauri/src). In a plain browser, for previews, each call answers as a fresh install
// would: no Settings, nothing reachable.

/** Hides the window (window.rs). */
export function hideWindow(): Promise<void> {
  return isTauri() ? invoke("hide_window") : Promise.resolve();
}

/** `api(method, path, body)` (commands.rs): the request with the saved API URL and Token. */
export const sendApi: Transport = (method, path, body) =>
  isTauri()
    ? invoke<ApiOutcome>("api", { method, path, body: body ?? null })
    : Promise.resolve({ kind: "notConfigured" });

export function loadSettings(): Promise<SavedSettings> {
  return isTauri()
    ? invoke<SavedSettings>("load_settings")
    : Promise.resolve(FRESH_SETTINGS);
}

/** Saves the URL and timezone to the settings file and a typed Token to Credential Manager. */
export function saveSettings(form: SettingsForm): Promise<SavedSettings> {
  const args = {
    apiUrl: form.apiUrl,
    ownerTimezone: form.ownerTimezone.trim(),
    token: form.token.trim() || null,
  };
  return isTauri()
    ? invoke<SavedSettings>("save_settings", args)
    : Promise.resolve({
        apiUrl: args.apiUrl.trim().replace(/\/+$/, ""),
        ownerTimezone: args.ownerTimezone,
        hasToken: true,
      });
}

/** `GET /v1/todos?state=open&limit=1` with the form's URL, and its Token or else the saved one. */
export function testConnection(
  apiUrl: string,
  token: string,
): Promise<ApiOutcome> {
  return isTauri()
    ? invoke<ApiOutcome>("test_connection", {
        apiUrl,
        token: token.trim() || null,
      })
    : Promise.resolve({ kind: "offline", reason: "not running in the app" });
}

/** The tray's "Settings…" (window.rs `show_settings`). Returns a function that stops listening. */
export function onOpenSettings(handler: () => void): () => void {
  if (!isTauri()) return () => {};
  const stop = listen("open-settings", handler);
  return () => void stop.then((unlisten) => unlisten());
}
