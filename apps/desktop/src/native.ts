import { invoke, isTauri } from "@tauri-apps/api/core";

/** Hides the window (the Rust side, src-tauri/src/window.rs). A no-op in a plain browser, for previews. */
export function hideWindow(): Promise<void> {
  return isTauri() ? invoke("hide_window") : Promise.resolve();
}
