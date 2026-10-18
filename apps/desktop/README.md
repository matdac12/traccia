# Desktop app

A small resident Windows window with the owner's open To-dos, shown and hidden with Caps+R. Spec: [`docs/desktop-app.md`](../../docs/desktop-app.md). Why Tauri, a thin client and no local database: [ADR 0018](../../docs/adr/0018-desktop-app-tauri-thin-client.md).

- `src/`: the front end (Vite, React, Tailwind). It imports the Dashboard's tokens from `apps/web/app/globals.css` and bundles Geist and Geist Mono from the `geist` package, so it looks like the Dashboard and works offline.
- `src-tauri/`: the Rust shell (Tauri 2). It owns the window, the tray, single instance, `--toggle`, the logon autostart, Settings storage, the one `api` command that talks to Traccia, and `open_url`, which opens a To-do's link in the default browser. Product logic stays in TypeScript.

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

It runs `vite build`, then `tauri build --no-bundle`, and writes `apps/desktop/src-tauri/target/release/traccia-desktop.exe` (about 3.5 MB). A first build fetches and compiles the crates and takes about 10 minutes; later ones take about 4.

## Build and install the installer

```sh
pnpm --filter desktop build:installer
```

It writes a per-user NSIS installer, `apps/desktop/src-tauri/target/release/bundle/nsis/Traccia_<version>_x64-setup.exe`: no signing, no auto-update, no administrator rights. The first run downloads NSIS into Tauri's cache. Run the setup (`/S` installs silently); it installs to `%LOCALAPPDATA%\Traccia\traccia-desktop.exe` with a Start menu entry. To upgrade, run a newer setup; it closes the running app first.

After installing:

- **Settings** (opens on first start): the API URL (`https://<tailnet host>`), a `todos` Token and the Owner timezone. Create the Token on the server with `docker compose exec -T api node dist/traccia.js token create --name desktop --actor you --scope todos`; the To-dos the app adds show "via desktop".
- **Autostart**: every start of the installed exe writes `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Traccia` = `"<exe>" --hidden`, so it is resident after the next logon. Turning it off in Task Manager's Startup apps sticks. Uninstalling (Settings → Apps) removes the Run value; the Token stays in Credential Manager (`cmdkey /delete:traccia-desktop:token`) and the settings in `%APPDATA%\app.traccia.desktop`.
- **Caps+R**: the owner's AutoHotkey script binds `CapsLock & r` to `"%LOCALAPPDATA%\Traccia\traccia-desktop.exe" --toggle`.

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
| `traccia-desktop.exe --toggle` | Elevated: starts the app through `explorer.exe`, so unelevated, shown, then exits. Not elevated: starts shown | Shows or hides the window; then exits |

Only one instance stays resident. Caps+R in the owner's AutoHotkey script, which runs elevated, runs `--toggle`; going through `explorer.exe` keeps the resident instance unelevated (§8). The elevated `--toggle` waits up to 3 s for the relaunched app to appear and exits with code 1 if it doesn't (Explorer not running). A launch that finds the resident mutex taken but nobody listening yet (two launches a few milliseconds apart) exits instead of becoming a second resident, so two Caps+R presses within about 150 ms of a cold start leave the window shown rather than shown and hidden.

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

## Actions on rows

`src/row-actions.ts` (the writes) and the list's keyboard in `src/app.tsx` (§4):

| Action | Mouse | Keyboard (row selected) |
|---|---|---|
| Mark done | Click the check | Space |
| Reopen | Click the check of a closed row | Space |
| Drop | Right-click the row | Del |
| Undo a drop | "Undo" in the toast | Ctrl+Z, while the toast shows |
| Open in the Dashboard | Click the title | Enter |

- ↑ ↓ move the selection (the orange bar); clicking a row's empty area selects it. Opening sends the To-do's `url` from the API to `open_url`, which only opens `http://` and `https://` links.
- Every write shows at once, and is put back with a short toast if Traccia refuses it. While offline nothing is sent: the checks are disabled and the keys say "changes are off".
- Closing a parent with open Sub-to-dos: the API answers 409 with `openSubTodos`, and a line under the row asks "Also mark 2 open Sub-to-dos done?". Yes or Enter sends it again with `closeSubTodos: true`; Cancel or Esc does nothing. Undo after such a drop reopens the parent, then its Sub-to-dos.
- Closed rows stay, struck through, until the window hides (Settings counts too); then they leave the list. They are in the Dashboard's Logbook.

## Adding a To-do

The composer (§5): `src/composer.ts` (the title's rules and the add), `src/composer-card.tsx` (the card) and `src/mention-input.tsx` (`@` autocomplete).

- **Open** it with the + in the title bar, or by typing while no input has focus: the first character goes into the title (Ctrl+Alt counts as AltGr, so `[` or `@` on an Italian keyboard opens it too). Space opens it too while no row is selected. Every show blurs whatever kept the focus outside the composer (the + after a click), so ↓ and Space drive the list. It is a card under the title bar over the dimmed list, which is inert while it is open; clicking the dimmed list or Esc closes it. The + while it is open goes back to the title and keeps the draft, and typing with the focus anywhere else in the card types into the title. While it is open the list's keys (↑ ↓, Space, Del, Enter, Ctrl+Z) are off.
- **Title**: one line, read with the Dashboard's quick-add rules from `packages/shared` (`@KEY`, today/oggi, tomorrow/domani, mon…sun, `HH:MM`) plus `anytime`. `@` lists active and paused Projects; ↑ ↓, Enter or Tab inserts `@KEY `, Esc closes the list.
- **Fields**: Day (default Today) and Reminder (default none) show what the title says, with a "typed" tag. Tab from the title reaches them; a click, Enter or Space opens the picker under them, and after a pick the focus is back in the title. Picking takes the matching words (every day word, or every time) out of the title, so the picked value is the one sent. Anytime removes the Reminder; a time on Anytime moves the day to Today.
- **Day picker** (`src/composer-pickers.tsx`, logic in `src/pickers.ts`): Today, Tomorrow, Next Mon and Anytime, then a Monday-first month grid with ‹ ›. Past days are disabled and it doesn't page before the current month. The highlighted day has the focus: arrows move it a day or a week, PgUp and PgDn a month, Home back to today, Enter or Space picks.
- **Reminder picker**: today "in 30 min", "in 1 h", "in 2 h" (those still before midnight) and "Tonight 21:00" while ahead; other days Morning 09:00, Lunch 12:30, Afternoon 15:00, Evening 18:00. The typed field reads `9`, `930`, `9:30`, `14:30`, `2pm`, `2:15p` and narrows the list to that time and its quarter hours; a morning time already passed today suggests the evening first (`9` at 14:32 → 21:00). The list is in 15-minute steps: today only times still ahead, each with "in 2 h 13 min"; other days it opens on 09:00. ↑ ↓ skip past times, Enter picks; "Remove Reminder" once one is set. Every "past" is in the Owner timezone.
- **Enter** posts `POST /v1/todos { title, day?, time? }`, with no `day` for Anytime. The composer stays open and empty, and a toast says "Added to Tue 20 Oct · Reminder 18:00". A time already past today in the Owner timezone reads "That time has already passed." and sends nothing; `anytime` with a time is refused the same way; an API refusal shows its message in red, and the text stays.
- **Esc** closes the `@` list or the open picker, then the composer, then the window. Hiding the window closes it. While offline the title is disabled and typing doesn't open it.

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
