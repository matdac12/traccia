# Desktop app

A small resident Windows window with the owner's open To-dos, shown and hidden with Caps+R. Spec: [`docs/desktop-app.md`](../../docs/desktop-app.md). Why Tauri, a thin client and no local database: [ADR 0018](../../docs/adr/0018-desktop-app-tauri-thin-client.md).

- `src/`: the front end (Vite, React, Tailwind). It imports the Dashboard's tokens from `apps/web/app/globals.css` and bundles Geist and Geist Mono from the `geist` package, so it looks like the Dashboard and works offline.
- `src-tauri/`: the Rust shell (Tauri 2). It owns the window, the tray, single instance, `--toggle`, the logon autostart, Settings storage and the one `api` command that talks to Traccia. Product logic stays in TypeScript.

## Checks

`pnpm check` at the root covers this package's TypeScript (Biome lint, `tsc`, Vitest under `test/`) and needs no Rust. The Rust side has its own tests:

```sh
cd apps/desktop/src-tauri && cargo test
```

`cargo test -- --ignored` also round-trips a Token through the real Credential Manager, under the test target `traccia-desktop-test:token`, and deletes it again.

## Build the exe

Needs the Rust toolchain (stable, MSVC), the Visual Studio 2022 Build Tools (C++ workload) and the WebView2 runtime, which Windows 11 ships with.

```sh
pnpm --filter desktop build:exe
```

It runs `vite build`, then `tauri build --no-bundle`, and writes `apps/desktop/src-tauri/target/release/traccia-desktop.exe` (about 3.5 MB). A first build fetches and compiles the crates and takes about 10 minutes; later ones take about 4. The installer comes with TRC-173.

## Run it while developing

```sh
pnpm --filter desktop tauri dev
```

That starts Vite on port 3170 and a debug build of the app on it. A debug build never registers the logon autostart. To look at the front end in a browser instead, run `pnpm --filter desktop dev` and open `http://127.0.0.1:3170/` (the window's content) or `/preview.html` (the window at 380×520 in the bottom-right corner of a fake desktop).

In a browser the page acts as a fresh install, so it opens Settings. To see the list with real data, point the dev server at an API:

```sh
VITE_TRACCIA_DEV_API=http://127.0.0.1:8871 TRACCIA_DEV_TOKEN=<a todos Token> pnpm --filter desktop dev
```

Vite then proxies `/v1/…` to that API and adds the Token itself, so the page never sees it; a stopped API reads as offline. A build ignores both variables.

## Command line

| Launch | No instance running | An instance running |
|---|---|---|
| `traccia-desktop.exe` | Starts shown | Shows the window |
| `traccia-desktop.exe --hidden` | Starts hidden (the logon autostart) | Shows the window |
| `traccia-desktop.exe --toggle` | Starts the app through `explorer.exe`, so unelevated, shown; then exits | Shows or hides the window; then exits |

Only one instance stays resident. Caps+R in the owner's AutoHotkey script, which runs elevated, runs `--toggle`; going through `explorer.exe` keeps the resident instance unelevated (§8).

## The window

- 380×520, frameless with Windows 11's rounded corners, no taskbar button, always on top while shown.
- Shown on the monitor the mouse is on, bottom-right of its work area (above the taskbar), 12 px from the edges.
- Hides on Esc, on losing focus, on Caps+R again, and from the tray.
- Follows the Windows light or dark setting, live.
- Tray icon: left-click shows or hides. Menu: "Open dashboard" (`<API URL>/personal`, enabled once Settings has an API URL), "Settings…", "Quit".

## The list

Every open To-do, Sub-to-dos included (§3): Overdue (oldest first, each row with its day), Today with its date, one heading per later day that has To-dos, then Anytime; within a day by Position. The title bar counts "today" (a Planned day of today or earlier) and "open". "Today" is in the Owner timezone from Settings, not the laptop's zone.

- **Freshness**: the list re-fetches on every show and every 30 s while shown, and makes no calls while hidden. The Rust side tells the front end with the `window-shown` and `window-hidden` events (`src-tauri/src/window.rs`). Projects (chip tooltips) are fetched once per show.
- **Offline**: the last list stays, read-only, under "Offline · showing the list from HH:MM · changes are off"; the next successful fetch clears it.
- A parent's "n/m" needs an API with Sub-to-do counts (TRC-177); against an older API it is left out.

## Settings and the API

- A fresh install opens **Settings**: API URL, Token and Owner timezone (default `Europe/Rome`), with **Test connection** (`GET /v1/todos?state=open&limit=1`). The tray's "Settings…" opens it later; Esc or the back arrow returns to the list.
- The **Token** is in Windows Credential Manager, target `traccia-desktop:token` (Control Panel → Credential Manager → Windows Credentials). It never goes in a file and never comes back to the front end. Create it with `traccia token create --name desktop --actor you --scope todos`.
- The API URL and Owner timezone are in `%APPDATA%\app.traccia.desktop\settings.json`.
- Every request goes through the Rust command `api(method, path, body)` (`src-tauri/src/api.rs`): it only sends `GET`, `POST` and `PATCH` to `/v1/…` under the API URL, adds `Authorization: Bearer <token>`, times out after 10 s, and reports network failures as `offline`. `src/api-client.ts` parses the answers with the `packages/shared` To-do schemas; a 401 or 403 becomes "Traccia refused the Token. Open Settings."

To start over: `cmdkey /delete:traccia-desktop:token`, then delete `%APPDATA%\app.traccia.desktop` (and the WebView2 cache in `%LOCALAPPDATA%\app.traccia.desktop`).

## Start at logon

A release build registers itself at every start under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, value `Traccia`, as `<exe path> --hidden`. To remove it:

```sh
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v Traccia /f
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" /v Traccia /f
```
