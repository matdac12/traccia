import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ApiMethod, ApiOutcome, Transport } from "./api-client";
import {
  DEFAULT_TIMEZONE,
  FRESH_SETTINGS,
  type SavedSettings,
  type SettingsForm,
} from "./settings";

// The Rust side (src-tauri/src). In a plain browser, for previews, each call answers as a fresh install
// would: no Settings, nothing reachable. The one exception is a dev server started with VITE_TRACCIA_DEV_API
// (README, "Run it while developing"): then the API calls go through Vite's proxy to that API, which adds the
// Token, so the page never sees it.

/** The dev proxy's API, in `vite` only; a build never has it. */
const DEV_API: string | undefined = import.meta.env.DEV
  ? import.meta.env.VITE_TRACCIA_DEV_API
  : undefined;

/** Through the dev proxy (vite.config.ts), which answers an unreachable API with this header. */
async function sendThroughDevProxy(
  method: ApiMethod,
  path: string,
  body?: unknown,
): Promise<ApiOutcome> {
  try {
    const response = await fetch(path, {
      method,
      ...(body !== undefined && {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
    const text = await response.text();
    return response.headers.get("x-traccia-dev-proxy") === "offline"
      ? { kind: "offline", reason: text }
      : { kind: "response", status: response.status, body: text };
  } catch (err) {
    return { kind: "offline", reason: String(err) };
  }
}

/** Hides the window (window.rs). */
export function hideWindow(): Promise<void> {
  return isTauri() ? invoke("hide_window") : Promise.resolve();
}

/** Opens a To-do's `url` in the default browser (commands.rs `open_url`, http and https only). */
export function openUrl(url: string): Promise<void> {
  if (isTauri()) return invoke("open_url", { url });
  window.open(url, "_blank", "noopener");
  return Promise.resolve();
}

/** `api(method, path, body)` (commands.rs): the request with the saved API URL and Token. */
export const sendApi: Transport = (method, path, body) =>
  isTauri()
    ? invoke<ApiOutcome>("api", { method, path, body: body ?? null })
    : DEV_API
      ? sendThroughDevProxy(method, path, body)
      : Promise.resolve({ kind: "notConfigured" });

export function loadSettings(): Promise<SavedSettings> {
  if (isTauri()) return invoke<SavedSettings>("load_settings");
  return Promise.resolve(
    DEV_API
      ? { apiUrl: DEV_API, ownerTimezone: DEFAULT_TIMEZONE, hasToken: true }
      : FRESH_SETTINGS,
  );
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

/**
 * Whether the window is shown: once now, then on every show and hide (window.rs emits `window-shown` and
 * `window-hidden`). In a browser, the page's visibility. Returns a function that stops listening.
 */
export function onWindowShown(handler: (shown: boolean) => void): () => void {
  if (!isTauri()) {
    const report = () => handler(document.visibilityState === "visible");
    report();
    document.addEventListener("visibilitychange", report);
    return () => document.removeEventListener("visibilitychange", report);
  }
  let live = true;
  void getCurrentWindow()
    .isVisible()
    .then((shown) => live && handler(shown));
  const stops = [
    listen("window-shown", () => handler(true)),
    listen("window-hidden", () => handler(false)),
  ];
  return () => {
    live = false;
    for (const stop of stops) void stop.then((unlisten) => unlisten());
  };
}
