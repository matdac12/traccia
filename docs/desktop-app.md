# Desktop app v1: spec

The **Desktop app** is a small Windows window that shows the owner's open To-dos while they work on the laptop. It stays resident in the background, appears in the bottom-right corner on **Caps+R**, and hides again as soon as the owner is done. It is one more REST client of the Personal Space, next to the Dashboard and Parla.

- Why Tauri, a thin client, no local database and no offline queue: [ADR 0018](adr/0018-desktop-app-tauri-thin-client.md).
- Approved UI: prototype **variant G** on branch `prototype/p12-desktop-app` (`prototypes/desktop-app/`, run with `pnpm prototype:desktop`). It is a reference to re-implement, not code to merge.
- Terms: the glossary's **Desktop app** and its "Personal Space" section. Domain rules are the Personal Space's ([`personal-space.md`](personal-space.md) §2); this app adds none.
- Build order: milestone **P12 Desktop app**, issues numbered `01` to `08` (§12).

## 1. Scope

In v1:

- One window listing **every open To-do**, ordered by Planned day.
- **Mark done**, **drop** (with undo) and **reopen**, including the Sub-to-do closing cascade.
- **Adding** a To-do in a floating composer, with typed or picked Planned day and Reminder.
- Opening any To-do in the Dashboard.
- Settings for the API, the Token and the Owner timezone.
- A tray icon, start with Windows, and **Caps+R** through the owner's AutoHotkey script.

Not in v1 (decided, see §11): editing a To-do's title, Details, day or Reminder; reordering; deleting; the Logbook; Windows notifications; offline writes; auto-update and code signing.

## 2. Window and lifecycle

- **Size and place**: 380×520, frameless, with Windows 11 rounded corners. Bottom-right of the **work area** (above the taskbar), 12 px from the edges, on the monitor **the mouse is on** when it is shown.
- **Resident**: one instance, started at logon (unelevated, hidden). Showing and hiding never restart it.
- **Shown**: always on top, focused, with no taskbar button. Every show re-fetches the list (§6) and scrolls to the top.
- **Hidden**: on Esc (when nothing inside is open, §5.6), on losing focus, on Caps+R again, or from the tray. While hidden it makes no network calls.
- **Tray icon**: left-click shows or hides. Menu: "Open dashboard" (`BASE_URL/personal`), "Settings…", "Quit".
- **Theme**: follows the Windows light or dark setting, in the Dashboard's look: Geist and Geist Mono, the orange accent `#ff9e0b`, and the tokens in `apps/web/app/globals.css`.

## 3. The list

### 3.1 Title bar

40 px high: **"Personal"**, then muted "7 today · 15 open", and a minimal **+** at the right (26 px, no border; orange on hover and while the composer is open). "Today" counts open To-dos whose Planned day is today or earlier.

### 3.2 Sections

Every open To-do, Sub-to-dos included, as one scrolling list with sticky section headings, each with its open count on the right:

1. **Overdue** (red), oldest day first. Each row shows its day ("Thu 15"), in red.
2. **Today**, with the date in muted text ("Today Sat 17 Oct"). When nothing is planned for today it reads "Nothing planned."
3. One heading per later day **that has To-dos**: "Tomorrow", then "Mon 19 Oct" and so on. Empty days are skipped.
4. **Anytime**, last.

Within a day, and within Anytime, the order is the manual **Position**, as in the Dashboard. A **Sub-to-do sits on its own Planned day**, not under its parent, with a faint "↳ Parent title" line under its title.

### 3.3 Row

From left to right:

- **Round check** (18 px).
- **Title** with `@KEY` chips (not clickable here). Clicking the title opens the To-do in the Dashboard.
- **"n/m"** in mono when it has Sub-to-dos (done/total).
- **Reminder time**, right-aligned, mono, with a bell: orange when pending; dimmed when sent or when the To-do is closed. A failed Reminder shows red, as in the Dashboard.
- The **day**, only in Overdue.

Marking a To-do done draws the Personal Space's 1.5 px orange line through the title (a 300 ms background-size transition, none under reduced motion). Dropping draws the line in muted grey.

## 4. Actions on rows

| Action | Mouse | Keyboard (row selected) | API |
|---|---|---|---|
| Mark done | Click the check | Space | `PATCH /v1/todos/:id {state:"done"}` |
| Reopen | Click the check of a closed row | Space | `PATCH … {state:"open"}` |
| Drop | Right-click the row | Del | `PATCH … {state:"dropped"}` |
| Undo a drop | "Undo" in the toast | Ctrl+Z | `PATCH … {state:"open"}` |
| Open in Dashboard | Click the title | Enter | opens the To-do's `url` in the default browser |

- **Selection**: ↑ ↓ move a highlighted row (an orange inset bar) when the composer is closed. Clicking a row's empty area selects it.
- **Closed rows stay** in place, struck through, until the window hides; then they leave the list (they are in the Logbook).
- **Drop toast**: "Dropped "Gym" · Undo", at the bottom of the window, for 5 seconds.
- **Closing a parent with open Sub-to-dos**: the API answers 409 with `details.openSubTodos`. An inline line appears under the row: "Also mark 2 open Sub-to-dos done? [Yes ↵] [Cancel]" (or "dropped"). Enter or Yes retries with `closeSubTodos: true`; Esc or Cancel does nothing.
- Every write updates the row optimistically and puts it back with a short error toast if the API refuses.

## 5. The composer

### 5.1 Opening it

- Click **+**, or **start typing** anywhere while the window is shown and no input has focus: the composer opens with that first character already typed. So Caps+R, typing and Enter adds a To-do without touching the mouse.
- It is a card floating under the title bar, over a dimmed list. Clicking the dimmed list closes it.

### 5.2 Title

- One line, "New To-do… @KEY", 14 px.
- **`@` autocomplete** works as in the Dashboard (`personal-space.md` §7.5): active and paused Projects from `GET /v1/projects`, keys by prefix first, then names, up to 7, with ↑ ↓, Enter or Tab to insert `@KEY `, and Esc to close the list.
- The title is parsed with the **Dashboard's quick-add rules**: `@KEY`; today/oggi, tomorrow/domani and mon…sun (the next such day); and `HH:MM`. The Desktop app adds one word, **`anytime`**, for no Planned day. Day and time words are removed from the title that is sent.

### 5.3 Fields

Under the title, two field buttons and an "↵ add" hint:

- **Day** (calendar icon): defaults to **Today**.
- **Reminder** (bell icon): defaults to none and reads "Reminder"; orange once set.

How typing and picking combine:

- A day or time **typed** in the title fills its field, which shows a small "typed" tag.
- **Picking** in a field removes the matching typed word from the title, so the picked value is the one used and the title stays clean.
- Picking **Anytime** removes the Reminder. Picking a **time** while the day is Anytime moves the day to Today. These are the same rules as the Dashboard's pickers.
- **Tab** from the title reaches the fields, and Enter or Space opens one. After a pick, focus returns to the title.

### 5.4 Day picker

- **Chips**: Today, Tomorrow, Next Mon, Anytime.
- **Month grid**, Monday first, with ‹ › to change month. Today is orange; past days are disabled; it can't page before the current month.
- **Keys**: arrows move the highlighted day (±1 day, ±1 week), PgUp and PgDn change month, Home goes back to today, Enter picks.

### 5.5 Reminder picker

- **Chips**:
  - Today: "in 30 min", "in 1 h" and "in 2 h" (each showing its real time, such as `15:02`), and "Tonight 21:00" while that is still ahead.
  - Other days: Morning 09:00, Lunch 12:30, Afternoon 15:00, Evening 18:00.
- **Typed time field**: accepts `9`, `930`, `9:30`, `14:30`, `2pm` and `2:15p`. The list below narrows to that time and its quarter hours. Today, when the typed time has already passed and is before noon, the same time in the evening is suggested first (`9` at 14:32 suggests 21:00).
- **List** in 15-minute steps:
  - Today it lists only future times, each with "in 2 h 13 min".
  - On other days it opens scrolled to 09:00.
- **Keys**: ↑ ↓ move, skipping past times; Enter picks.
- "Remove Reminder" appears once a time is set.
- A time that has already passed today can't be picked; typing one shows "That time has already passed." This mirrors the API's own refusal.

### 5.6 Adding and closing

- **Enter** in the title posts `POST /v1/todos { title, day?, time? }`, omitting `day` for Anytime.
- On success the composer **stays open and empty**, for the next one, and a toast says where it went: "Added to Tue 20 Oct · Reminder 18:00".
- On a 400, the API's message shows in red under the fields and the text stays.
- **Esc** closes, in order: the open picker, then the composer, then the window.

## 6. Data and API

- **Endpoints**:
  - `GET /v1/todos?state=open` (paged to the end), for the list;
  - `GET /v1/projects`, for chips and `@` autocomplete (cached per show);
  - `POST /v1/todos` and `PATCH /v1/todos/:id`.
  - Nothing else. That is exactly what a `todos`-scoped Token allows (`personal-space.md` §5).
- **Requests go through the Rust side**, not the webview's `fetch`:
  - The API sends no CORS headers, and the Token never enters JavaScript.
  - Rust exposes one command, roughly `api(method, path, body) → { status, body }`, that adds `Authorization: Bearer <token>` from the Credential Manager.
  - The TypeScript side validates responses with the `packages/shared` To-do schemas.
- **Freshness**: re-fetch on every show and every **30 s** while shown. Never while hidden.
- **Today**: "today", Overdue and the pickers' past-time checks use the **Owner timezone** from Settings (default `Europe/Rome`, matching the API's `OWNER_TIMEZONE`), not the laptop's zone.
- **Offline** (network error or timeout):
  - The last fetched list stays, read-only, with a slim line under the title bar: "Offline · showing the list from 14:30 · changes are off".
  - Checks, drop and + are disabled, and typing doesn't open the composer.
  - The next successful fetch clears the line.
- **401 or 403**: a line reads "Traccia refused the Token. Open Settings." and links to Settings.

## 7. Settings and secrets

- On first launch, and from the tray's "Settings…", the window shows a small form:
  - **API URL** (the tailnet host, e.g. `https://<tailnet-host>`);
  - **Token**;
  - **Owner timezone** (IANA name, default `Europe/Rome`, validated with `Intl.DateTimeFormat`);
  - **Test connection** (`GET /v1/todos?state=open&limit=1`).
- The **Token is stored in Windows Credential Manager** (the Rust `keyring` crate), never in a file. The URL and timezone go in a small JSON file in the app's config directory.
- The Token is `traccia token create --name desktop --actor you --scope todos`, so To-dos created here show "via desktop".

## 8. Hotkey and single instance

- **Single instance** (`tauri-plugin-single-instance`). Running `traccia-desktop.exe --toggle` while it runs makes the resident instance show or hide, and the second process exits at once.
- **Elevation trap**: the owner's `hyper.ahk` runs elevated, so anything it launches starts elevated. If `--toggle` finds **no** resident instance, it starts the app **unelevated** through the shell (`explorer.exe <path to exe>`), then exits. It never stays resident itself.
  - A plain launch with no arguments starts shown.
  - The logon autostart passes `--hidden`.
- **AutoHotkey binding** in `C:\Users\MattiaDaCampo\Scripts\hyper.ahk` (AutoHotkey v2; see the `shortcut-expert` skill):
  - `CapsLock & r` runs the installed exe with `--toggle`, then `KeyWait "CapsLock", "T0.4"`.
  - `CheatSheetText()` gets the line `Caps+R  Traccia To-dos`.
  - Reload through the `HyperKey` scheduled task. Only the owner can confirm that the key fires.

## 9. Tech and repository

- `apps/desktop`, in the pnpm workspace:
  - **Tauri 2**, with a Vite + React + Tailwind front end that reuses the Dashboard's tokens;
  - plugins: single-instance, autostart and opener;
  - Rust crates: `keyring` and `reqwest`.
- **Shared code** in `packages/shared`:
  - the To-do schemas (already there);
  - the **quick-add parser** and **`@` matching**, moved out of `apps/web` once the P11 dashboard epic lands, and then used by both apps.
- **`pnpm check` stays Rust-free**: the desktop package's TypeScript lint, typecheck and Vitest run with everything else. Building the exe needs the Rust toolchain and is a separate command.

## 10. Testing

The repository's existing standards apply: Vitest, `pnpm check`, and no browser e2e on Windows.

- **Shared**: quick-add parsing, including `anytime`; `@` matching.
- **Desktop TypeScript**:
  - list grouping (Overdue order, skipped empty days, Sub-to-dos on their own day, Anytime last);
  - "today" in the Owner timezone across midnight and the DST changes;
  - the typed-or-picked rules for the fields (§5.3);
  - typed time parsing (`9`, `930`, `2pm`, the evening suggestion);
  - the picker key handling;
  - the 409 cascade flow;
  - offline state.
- **Rust**: the API command adds the bearer and passes status and body through; the Token never appears in logs.
- **By hand, on the laptop** (the owner confirms): Caps+R shows and hides; it shows on the monitor with the mouse; it hides on focus loss; it starts at logon; Settings round-trips through Credential Manager.

## 11. Out of scope (decided)

- Editing a To-do's title, Details, Planned day or Reminder (open it in the Dashboard)
- reordering and deleting
- the Logbook and other Dashboard lists
- Windows toast notifications (Telegram stays the only Reminder channel)
- a local database, offline writes or a write queue (ADR 0018)
- auto-update, code signing and CI builds
- macOS or Linux builds
- the app registering its own global shortcut (AutoHotkey owns hotkeys on this machine)

## 12. Build order

Milestone **P12 Desktop app**, one issue per step, in order:

1. **TRC-168**: Desktop app shell: Tauri in `apps/desktop`, resident window, tray, single instance and `--toggle`, placement, autostart, theme
2. **TRC-169**: Settings, Credential Manager and the Rust API client
3. **TRC-170**: The open To-dos list
4. **TRC-171**: Done, drop, undo, the closing cascade and keyboard selection
5. **TRC-172**: Move the quick-add parser and `@` matching to `packages/shared` (after the P11 dashboard epic; it can run beside 01 to 04)
6. **TRC-174**: The composer: +, type to add, title parsing and `@` autocomplete
7. **TRC-175**: Day and Reminder pickers in the composer
8. **TRC-173**: Installer, Caps+R and rollout on the laptop (also blocked by TRC-165, the P11 production rollout)
