# The Desktop app is a Tauri 2 thin client over REST, with no local database

The owner wanted a small Windows window showing their open To-dos, summoned by a hotkey while they work, and "as light and fast as possible". It stays resident in the background and is shown and hidden, never started on demand, so startup time doesn't matter but idle memory does.

We chose **Tauri 2** (Rust shell, the system WebView2) in the monorepo as `apps/desktop`. It is a **thin client**: it reads and writes only through `/v1/todos` (and read-only `/v1/projects`) over the tailnet, with its own `todos`-scoped Token (`desktop`, actor `you`), so its To-dos show "via Desktop". It has **no local database and no offline queue**: off the tailnet it shows the last fetched list read-only and refuses writes, the same rule Parla follows.

Tauri costs about 30 to 60 MB of RAM at idle, which is more than a natively drawn UI. In return the UI is TypeScript, so it reuses the `packages/shared` To-do schemas and the dashboard's quick-add parser instead of re-implementing them in a second language, and it can match the dashboard's look.

## Considered options

- **Rust with egui or Slint.** The lightest (about 10 to 20 MB), but a custom-drawn UI with no code reuse; the quick-add parser and schemas would be written twice.
- **C# with WPF or WinUI 3.** Similar memory, a second language and toolchain in the repo, and no reuse.
- **Electron.** Ships its own Chromium: the heaviest option, against the stated goal.
- **An AutoHotkey v2 GUI** (AutoHotkey already runs the owner's hotkeys). Tiny, but a poor fit for HTTP, JSON and a list that looks decent.
- **A local SQLite copy with sync.** Rejected: a second writer breaks the single-writer rule (ADR 0001), and conflict handling isn't worth it for a list used online.

## Consequences

- The app is useless without the tailnet. That's accepted, as it is for the Dashboard and Parla (ADR 0007).
- A Rust toolchain joins the repo, but only for the thin Tauri shell; product logic stays in TypeScript.
- To-dos still get no MCP tools (ADR 0017); the Desktop app is one more REST client.
- Spec: `docs/desktop-app.md`. Milestone: P12 Desktop app.
