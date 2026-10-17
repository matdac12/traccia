# Desktop app

A small resident Windows window with the owner's open To-dos, shown and hidden with Caps+R. Spec: [`docs/desktop-app.md`](../../docs/desktop-app.md). Why Tauri, a thin client and no local database: [ADR 0018](../../docs/adr/0018-desktop-app-tauri-thin-client.md).

- `src/`: the front end (Vite, React, Tailwind). It imports the Dashboard's tokens from `apps/web/app/globals.css` and bundles Geist and Geist Mono from the `geist` package, so it looks like the Dashboard and works offline.
- `src-tauri/`: the Rust shell (Tauri 2). It owns the window, the tray, single instance, `--toggle` and the logon autostart. Product logic stays in TypeScript.

## Checks

`pnpm check` at the root covers this package's TypeScript (Biome lint, `tsc`, Vitest under `test/`) and needs no Rust. The Rust side has its own tests:

```sh
cd apps/desktop/src-tauri && cargo test
```

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
- Tray icon: left-click shows or hides. Menu: "Open dashboard" (enabled once Settings has the API URL, TRC-169), "Settings…" (for now it shows the window), "Quit".

## Start at logon

A release build registers itself at every start under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, value `Traccia`, as `<exe path> --hidden`. To remove it:

```sh
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v Traccia /f
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" /v Traccia /f
```
