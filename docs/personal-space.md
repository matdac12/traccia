# Personal Space v1: spec

The Personal Space is the owner's private layer **above** all Projects: To-dos they intend to do, nudged by Reminders on Telegram, and creatable by voice from Parla. Projects stay where agents work; the Personal Space is where the owner plans their own days.

- Decisions, with the reasoning behind each: wayfinder map **TRC-142** and its closed tickets TRC-143 to TRC-149.
- Approved UI: prototype variant A ("Lists") on branch `prototype/trc-148-personal-space` (`apps/web/components/prototype-personal/`). It is a reference to re-implement, not code to merge.
- Terms: the "Personal Space" section of [`GLOSSARY.md`](../GLOSSARY.md). Why To-dos are not Issues and get no MCP tools: [ADR 0017](adr/0017-todos-are-not-issues.md).
- Build order: milestone **P11 Personal Space**, issues numbered `01` to `15` (§12).

## 1. Scope

In v1:

- To-dos with an optional Planned day, an optional Reminder, optional Details, Project references, one level of Sub-to-dos, and the states open, done and dropped.
- Reminders delivered as plain Telegram messages by an in-process scheduler.
- REST endpoints under `/v1/todos` for the dashboard and for Parla, plus a `todos` Token scope.
- A `/personal` page in the dashboard: Today, Upcoming, Anytime, Logbook and By project lists, a details panel, and inline editing.
- To-dos in Trash.

Not in v1 (decided, see §11): MCP tools, tags, recurrence, due dates, Gantt or calendar views, multiple Reminders, Reminders on Issues, Telegram buttons or webhooks, To-dos on Project pages, To-dos in global search, an activity log, and comments or attachments on To-dos.

## 2. Domain rules

Use the glossary's words in code, docs and UI.

1. A **To-do** has a title (1 to 500 characters), an optional **Planned day**, an optional **Reminder**, optional **Details** (markdown), a state (`open`, `done`, `dropped`), and an optional parent.
2. **Sub-to-dos** go one level deep. A Sub-to-do is a full To-do with its own day, Reminder and references, but it cannot have children. The parent must be open and not deleted when the Sub-to-do is created.
3. A parent **never completes on its own**. Closing a parent that has open Sub-to-dos needs explicit confirmation, and then closes them the same way (done → done, dropped → dropped).
4. The **Planned day** is the day the owner intends to do the To-do, not a deadline. An open To-do whose day has passed is **Overdue**: it stays on its day and shows in Today until the owner moves or closes it. To-dos without a day are **Anytime**.
5. A **Reminder** is a time of day (`HH:MM`) on the To-do's Planned day, so only a To-do with a day can have one. A To-do has at most one. Its moment is the Planned day plus the time, in the **Owner timezone** (`OWNER_TIMEZONE`, default `Europe/Rome`).
   - Removing the day (moving to Anytime) removes the Reminder. The dashboard warns first.
   - Setting a Reminder on an undated To-do sets the day to today.
   - A moment that is not in the future is refused when set or moved.
   - Changing the moment (the time or the day) **re-arms** the Reminder, even if it was already sent. Editing the title or Details doesn't.
6. **Project references** come from the title: every `@KEY` (2 to 8 letters and digits, case-insensitive) naming an existing Project becomes a reference.
   - They are re-derived on every title save, and are never inherited by Sub-to-dos.
   - An unknown key stays plain text and is never an error.
   - A reference to a soft-deleted Project stays, and shows as a greyed chip. It is live again if the Project is restored.
   - References carry no sync with the Project's Issues.
7. **Position**: manual order within one bucket, which is a single Planned day or Anytime (per parent). A new or moved To-do goes to the bottom of its new bucket.
8. **Delete** is soft. Deleting a To-do deletes its Sub-to-dos in the same batch, and Restore brings the batch back. Purge follows the existing rules.
9. **Source**: every To-do stores the name of the Token that created it (e.g. `parla`) and shows "via Parla" for that token. It is copied at creation, so revoking the Token later doesn't erase it.
10. The **Logbook** holds every done and dropped To-do forever, grouped by the day it was closed (in the Owner timezone).

## 3. Data model

A new migration, `0005_todos.sql`, follows the existing conventions: ULID ids, ISO UTC timestamps, actor `CHECK`s, and soft-delete columns.

```sql
CREATE TABLE todos (
  id                      TEXT PRIMARY KEY,
  title                   TEXT NOT NULL,
  day                     TEXT,                    -- YYYY-MM-DD, Owner timezone; NULL = Anytime
  reminder_time           TEXT,                    -- HH:MM; requires day
  reminder_status         TEXT,                    -- pending | sent | failed | skipped; NULL when no Reminder
  reminder_sent_at        TEXT,
  reminder_attempts       INTEGER NOT NULL DEFAULT 0,
  reminder_next_attempt_at TEXT,                   -- set while retrying a transient failure
  reminder_failure        TEXT,                    -- telegram_unauthorized | telegram_forbidden | telegram_rejected | gave_up
  state                   TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','done','dropped')),
  closed_at               TEXT,
  parent_id               TEXT REFERENCES todos(id),
  position                REAL NOT NULL DEFAULT 0,
  details                 TEXT,
  created_by              TEXT NOT NULL CHECK (created_by IN ('agent','you')),
  created_by_token        TEXT NOT NULL,           -- token name at creation ("via Parla")
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  deleted_at              TEXT,
  deleted_batch           TEXT,
  deleted_by              TEXT,
  CHECK (reminder_time IS NULL OR day IS NOT NULL),
  CHECK ((reminder_time IS NULL) = (reminder_status IS NULL))
);
CREATE INDEX todos_open_day ON todos(state, day) WHERE deleted_at IS NULL;
CREATE INDEX todos_parent ON todos(parent_id);
CREATE INDEX todos_due ON todos(day, reminder_time)
  WHERE state = 'open' AND reminder_status = 'pending' AND deleted_at IS NULL;
CREATE INDEX todos_closed ON todos(closed_at DESC, id DESC) WHERE state <> 'open' AND deleted_at IS NULL;

CREATE TABLE todo_references (
  todo_id    TEXT NOT NULL REFERENCES todos(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  PRIMARY KEY (todo_id, project_id)
);
```

**Tokens**: the existing `tokens.scopes` column (`DEFAULT 'all'`, reserved in spec §7.2 for exactly this) takes a second value, `todos`. No migration is needed for it.

**Config** (`apps/api/src/config.ts`, plus the README table, which `readme.test.ts` enforces):

| Variable | Default | Purpose |
|----------|---------|---------|
| `OWNER_TIMEZONE` | `Europe/Rome` | IANA zone that decides where a day starts and ends for Planned days, Reminders and the Logbook. Validated with `Intl.DateTimeFormat` |
| `TELEGRAM_BOT_TOKEN` | unset | Bot token for Reminder delivery. Unset means Reminders are off, and the dashboard says so (§8.5) |
| `TELEGRAM_CHAT_ID` | unset | Chat to deliver to. Both Telegram variables must be set together, or the API fails to start |

## 4. Service rules (`apps/api/src/service/todos.ts`)

REST is a thin adapter over this service (ADR 0006). All writes go through `ctx.write`.

- **create** `{ title, day?, time?, remindAt?, parentId?, details? }`:
  - Sending both `time` and `remindAt` is a 400.
  - `remindAt` (ISO with an offset) becomes `day` and `time` in the Owner timezone. Seconds are dropped.
  - `time` without `day` uses today.
  - The moment must be in the future.
  - `parentId` must be an open, non-deleted, top-level To-do.
  - The new To-do goes to the bottom of its bucket. References are derived from the title. `created_by` and `created_by_token` come from the request's token.
- **update** (partial; an empty patch is 400) `{ title?, day?, time?, details?, state?, closeSubTodos?, expectedUpdatedAt? }`:
  - `day: null` clears the Reminder as well.
  - `time: null` removes the Reminder.
  - `time` on an undated To-do sets the day to today.
  - Any change to the moment re-validates it (must be in the future), sets `reminder_status = 'pending'`, and clears the attempts, failure and sent time.
  - A new `day` moves the To-do to the bottom of that bucket.
  - **Closing** (`state: done|dropped`) a To-do that has open Sub-to-dos throws `conflict` with `details.openSubTodos`, unless `closeSubTodos: true` is sent. With it, the open Sub-to-dos close the same way, in the same transaction.
  - Closing sets `closed_at`. **Reopening** clears it; a reopened pending Reminder whose moment has passed becomes `skipped`, so it never pings late.
  - A stale `expectedUpdatedAt` (or `If-Match`) throws `conflict` with `details.currentUpdatedAt`, as for Issues.
- **position** `{ beforeId?, afterId?, expectedUpdatedAt? }`: same algorithm as `service/issue-position.ts`, scoped to the To-do's bucket (same `day`, or Anytime, and same `parent_id`). Neighbours from another bucket are a 400.
- **list** `{ state: 'open' | 'closed', cursor?, limit? }`:
  - `open` returns every open To-do as a flat list, Sub-to-dos included, ordered by `day` (nulls last), then `position`, then `id`. Use offset paging over a small array, like projects.
  - `closed` is the Logbook: keyset paging on `(closed_at desc, id desc)`.
  - Deleted To-dos are excluded unless `includeDeleted=true`.
- **get** `id`: one To-do, including a deleted one.
- **delete / restore / purge**: through `service/trash.ts` with a new type, `todo`. Its Sub-to-dos join the same batch. Register the type everywhere `TRASH_TYPES` is enumerated: `trash.ts` collect/find/stamp/list, `rest-issue-schemas.ts`, `RESTORE_TYPES`, and the web `TRASH_TYPES` and `countsSchema`.
- Every write calls `reminders.reschedule()` (§6).

## 5. REST API

Request and response schemas live in `packages/shared` (`todo-schemas.ts`); the API and the dashboard both import them, following where TRC-137 is heading. Errors use the standard body `{ error: { code, message, details } }`. Document the endpoints in `docs/rest-todos.md`, in the same style as `docs/rest-issues.md`.

| Method and path | Body or query | Result |
|---|---|---|
| `GET /v1/todos?state=open` | `cursor`, `limit` (max 250) | `{ items: Todo[], nextCursor }` |
| `GET /v1/todos?state=closed` | `cursor`, `limit` | Logbook page |
| `GET /v1/todos/:id` | | `Todo` |
| `POST /v1/todos` | `{ title, day?, time?, remindAt?, parentId?, details? }` | `201 Todo` |
| `PATCH /v1/todos/:id` | `{ title?, day?, time?, details?, state?, closeSubTodos?, expectedUpdatedAt? }` | `Todo` |
| `PATCH /v1/todos/:id/position` | `{ beforeId?, afterId?, expectedUpdatedAt? }` | `Todo` |
| `DELETE /v1/todos/:id` | `?purge=true` | `DeleteResult` |
| `POST /v1/restore` | `{ type: "todo", id }` | existing route |
| `GET /v1/todos/delivery` | | `{ ok, reason?, lastSentAt? }` (§6.4) |

```ts
type Todo = {
  id: string;
  title: string;                       // as typed, @KEYs included
  references: { key: string; projectId: string; projectDeleted: boolean }[];
  day: string | null;                  // YYYY-MM-DD
  reminder: {
    time: string;                      // HH:MM
    status: "pending" | "sent" | "failed" | "skipped";
    failure: "telegram_unauthorized" | "telegram_forbidden" | "telegram_rejected" | "gave_up" | null;
    sentAt: string | null;
  } | null;
  state: "open" | "done" | "dropped";
  closedAt: string | null;
  parentId: string | null;
  position: number;
  details: string | null;
  source: string;                      // creating token's name
  url: string;                         // `${BASE_URL}/personal?todo=${id}`
  createdAt: string;
  updatedAt: string;
  deleted?: true;
};
```

**Validation** (400 `validation_error`, with `details.fields`):

- title empty or longer than 500 characters
- malformed `day` (`YYYY-MM-DD`) or `time` (`HH:MM`, 00:00 to 23:59)
- both `time` and `remindAt`
- a moment in the past
- `parentId` missing, not top-level, closed or deleted
- `day: null` together with `time`

**Token scope**: `traccia token create --name parla --actor you --scope todos` stores `scopes = 'todos'`; `--scope` is `all` (the default) or `todos`, and anything else is rejected. A `todos` token may call:
- `/v1/todos` and everything under it, so it can create, list, edit, close, delete and restore To-dos. It **may not purge**: `DELETE /v1/todos/:id?purge=true` returns 403 `forbidden`, because a misheard voice command must never erase a To-do for good (decided in TRC-157);
- `POST /v1/restore` with `type: "todo"`;
- **read-only** `GET /v1/projects` and `GET /v1/projects/:id` (so Parla can learn the keys);
- `GET /v1/me`.

Everything else, including `/mcp` and `/files`, returns 403 `forbidden` with a message that says what the token may use. The scope is checked before the route runs, so a denied request changes nothing. Tokens with `scopes = 'all'` behave exactly as today, and OAuth tokens are always `all`. `token list` shows the scope.

**Purging To-dos is reserved for `you`**, whatever the scope: an `agent` Token cannot purge a To-do even with `ALLOW_AGENT_PURGE=true` (the switch still covers every other type).

## 6. Reminders

### 6.1 Scheduler (`apps/api/src/reminders/scheduler.ts`)

It runs inside the `api` process. There is one instance (ADR 0001), so there are no competing senders.

- **Exact timer**: on start, and after every To-do write (`reschedule()`), find the earliest due moment among open, non-deleted To-dos whose `reminder_status = 'pending'`. Use `reminder_next_attempt_at` when it is set. Sleep until `min(that moment, now + 5 min)`.
- **Safety check**: the 5-minute cap means a check runs at least every 5 minutes, even if the timer is wrong. A check also runs at startup, to catch up after downtime.
- **Each check**:
  - Pending Reminders whose moment has passed **on an earlier day** in the Owner timezone become `skipped`.
  - Those due today are sent oldest first, **at least 1 second apart** (Telegram's per-chat limit).
- **Delivery semantics: at-least-once**. A Reminder is marked `sent` only after Telegram answers `ok: true`. A timeout followed by a retry may deliver twice; that is accepted.

### 6.2 Telegram (`apps/api/src/reminders/telegram.ts`)

This follows the TRC-144 research document `research-telegram-reminder-delivery.md`.

- `POST https://api.telegram.org/bot<TOKEN>/sendMessage` with `{ chat_id, text, link_preview_options: { is_disabled: true } }`. Plain text: no `parse_mode`, so nothing needs escaping.
- Text: `⏰ 15:00 Call the bank about the mortgage @CRM`, a newline, then the To-do's `url`. Insert `(late)` after the time when the message goes out more than 5 minutes after its moment.
- **Never log the request URL or the token.** Redact `bot<…>` in any error that is logged.

### 6.3 Failures and retries

| Telegram outcome | Action |
|---|---|
| `ok: true` | `sent`, `reminder_sent_at = now` |
| 429 | Wait `retry_after` seconds, then retry |
| 5xx, network error, timeout | Retry after about 30 s, 2 min, 10 min, then every 10 min (`reminder_attempts`, `reminder_next_attempt_at`), until the end of the moment's day. Then `failed` with `gave_up` |
| 401 | `failed`, `telegram_unauthorized` (token revoked or rotated) |
| 403 | `failed`, `telegram_forbidden` (bot blocked, or chat never started) |
| other 400 | `failed`, `telegram_rejected` |

### 6.4 Health

- `/healthz` (unauthenticated) adds `reminders: { lastCheckAt }`, and answers **503** when the last check is more than 10 minutes old. The compose healthcheck then flags the container as unhealthy.
- `GET /v1/todos/delivery` reports the delivery state, held in memory:
  - `ok: true` after start, and after any successful send
  - `ok: false, reason: "not_configured"` when the Telegram variables are unset
  - `ok: false, reason: "telegram_unauthorized" | "telegram_forbidden"` after a permanent failure of that kind, until the next success or a restart (fixing `.env` needs a restart anyway)

## 7. Dashboard

Desktop first: the owner uses it from a laptop about 95% of the time. Build it to the prototype's variant A, in the existing Linear-calm style (Geist, the orange accent, shadcn and Radix, the existing tokens). Writes go through server actions, as in `app/(app)/issues/actions.ts`. Reads follow the existing data-refresh polling (TRC-52). Each poll is cheap when nothing changed: the To-do lists answer `304` to `If-None-Match` ([`rest-todos.md`](rest-todos.md#conditional-requests)), and the dashboard's own poll route does the same toward the browser.

### 7.1 Placement

- Route `/personal` (`app/(app)/personal/page.tsx`).
- The sidebar gets **"Personal"** (lucide `Sun`) as the first item, above Issues.
- The page header title is "Personal".

### 7.2 Layout

Three columns on a laptop:

1. **A list menu inside the page** (about 208 px):
   - Today (count of open today plus Overdue), Upcoming, Anytime (count), Logbook.
   - A "By project" section: the keys referenced by open To-dos, each as a chip with a count.
   - Below `md` it becomes a horizontally scrolling tab strip.
2. **The list** (max width 680, centered).
3. **The details panel** (340 px) when a To-do is selected, on wide screens. On narrow screens it becomes a dialog.

### 7.3 Lists

- **Today**:
  - A large weekday heading (Geist Sans, about 34 px, semibold, tight tracking), then the date, the open count and how many Reminders are still to come.
  - Quick add.
  - **Overdue** (red label, each row showing its day).
  - **Today**: the open top-level To-dos in manual order (drag handle on hover), then today's dated Sub-to-dos as a second block, each row with its parent's title as a small prefix. Each block is ordered and dragged on its own, so a drop lands where it was released (Position can't be compared across buckets, TRC-181).
  - Today's done and dropped To-dos, which stay at the bottom struck through. Dropped uses the same orange strike as done.
- **Upcoming**: the next 14 days, one section per day. Empty days are dimmed and say "Nothing planned". Below them, **Later** lists every open To-do planned after those 14 days, grouped by day, each day with its label (decided in TRC-163). Later is hidden when it has no To-dos.
- **Anytime**: quick add (with no day), then the list in manual order. A parent shows its open Sub-to-dos indented underneath (done and dropped ones are in the Logbook).
- **Logbook**: grouped by close day, newest first, loading more on scroll.
- **By project**: a big key chip as the heading, and the open To-dos referencing that key, sorted by day. Sub-to-dos never appear here, since they carry no references of their own (§2.6).

### 7.4 Row

From left to right:

- **Round check**, with a 44 px hit area on touch.
- **Reminder time column**: monospace, about 44 px wide, with a bell. Orange when pending, dimmed when sent or closed, red with a bell-off icon when failed. It is empty on hover as a `––:––` placeholder that opens the Reminder picker.
- **Title** with Project chips.
- A dot when the To-do has Details, a Sub-to-do count `n/m`, and "via Parla".
- The **day**, shown only in lists where it varies (red when Overdue). It opens the day picker; on Today rows a calendar icon appears on hover instead.
- The **"…" menu**.

Marking a To-do done draws a 1.5 px orange line through the title (a background-size transition of about 300 ms, none under reduced motion). This is the Personal Space's signature; keep it.

### 7.5 Interactions

- **Quick add**:
  - Parses `@KEY`, a day word (today/oggi, tomorrow/domani, anytime = no Planned day, and a weekday = the next such day, in English or Italian, short or full: mon/monday, lun/lunedì…) and `HH:MM` or `H:MM` (which implies today when no day is given; with anytime it is refused, as a Reminder needs a Planned day). Day words match whole words only. `15.00` is not a time, so "Pay 12.50" stays a title.
  - When a day word or a time appears twice, the last one wins.
  - A read-back line shows the time, the title with chips, and the day before you press Enter.
  - It posts `{ title, day, time }`.
- **`@` autocomplete** in quick add, the Sub-to-do input and title editing:
  - Lists active and paused Projects, matching keys by prefix first, then names containing the text, up to 7.
  - ↑ ↓ to move, Enter or Tab inserts `@KEY `, Esc closes.
  - It is an ARIA combobox and listbox.
- **Project chips** link to the Project page (`/projects/:id`). A chip for a deleted Project is greyed and not clickable.
- **Day picker**:
  - Today, Tomorrow and Next week (next Monday), a Monday-first month grid, and Anytime.
  - Anytime warns "removes the Reminder" when there is a pending one. A sent, failed or skipped Reminder is removed without asking.
  - It opens from the row day label or icon and from the details panel.
- **Reminder picker**:
  - Presets 09:00, 12:30, 15:00, 18:00, 20:30 and 22:00, an exact time field, and Remove.
  - Moments already past are disabled. The exact field says "That time has already passed", and the presets carry a tooltip and a line saying past times are disabled.
- **"…" menu**: Move to (the next 7 days, or Anytime), Reminder, Mark done, Drop, Reopen, Delete, and in Today and Anytime also Move up and Move down. These are the single-pointer alternative to drag (WCAG 2.2, 2.5.7); Move up/down call the position endpoint with the neighbour's id.
  - Delete shows an undo notice that calls Restore (there is still no confirm).
  - Mark done and Drop from the menu animate the strike like the check does.
- **Closing a parent** that has open Sub-to-dos: on a 409 with `openSubTodos`, a confirm dialog ("Mark 2 open Sub-to-dos done too?") retries with `closeSubTodos: true`.
- **Drag to reorder** within Today and Anytime uses dnd-kit (already a dependency) and calls the position endpoint.

### 7.6 Details panel and deep link

- The URL holds the selection: `?list=` names the list (`today`, `upcoming`, `anytime`, `logbook` or `project:KEY`) and `?todo=<id>` adds the panel on top, e.g. `/personal?list=anytime&todo=<id>`.
- `/personal?todo=<id>` alone selects the To-do and opens the panel over the list it belongs to. That is Today for today and Overdue, Upcoming for future days, Anytime, or the Logbook. This is the link in every Telegram message and in the API's `url`.
- The panel contains:
  - The title. Click to edit, with `@` autocomplete; Enter or blur saves, Esc cancels.
  - **Planned day** and **Reminder** fields that open the pickers.
  - The failure text for a failed Reminder: "Telegram refused it. Check the bot settings." for the Telegram failures, and "Telegram couldn't be reached before the day ended." for `gave_up`.
  - "Created via Parla" or "in the dashboard" (any other token reads "in the dashboard" for now).
  - **Details**: a textarea that saves on blur.
  - For top-level To-dos, **Sub-to-dos** with an "Add a Sub-to-do" input.
  - A "…" menu with the row menu's actions (Move to, Reminder, Mark done, Drop, Reopen, Delete), so a To-do opened from Telegram that has no row on screen can still be acted on.

### 7.7 Trash and banners

- The Trash page lists To-dos as a type, "To-dos", with restore and purge like the others.
- When `GET /v1/todos/delivery` is not `ok`, the Personal Space shows a slim banner above the list:
  - `not_configured`: "Reminders are off: Telegram is not configured."
  - `telegram_unauthorized`: "Reminders can't be sent: the Telegram bot token was rejected."
  - `telegram_forbidden`: "Reminders can't be sent: the bot can't message the chat."

## 8. Parla

Parla's `create_reminder` command-mode tool (PARLA-82) calls `POST /v1/todos` with `{ title, remindAt }` using a `todos`-scoped token over the tailnet. It reads the Project list (`GET /v1/projects`) to put "KEY: Name" pairs in its prompt, so the model writes `@KEY` itself. Building it is outside this milestone.

## 9. Testing

The repository's existing standards apply: Vitest, `pnpm check`, and no browser e2e on Windows.

- **Service**:
  - every rule in §2 and §4, including remindAt conversion across the October and March DST changes in `Europe/Rome`
  - the closing cascade and its 409
  - re-arming, and skipping on reopen
  - reference derivation (case, unknown keys, deleted Projects)
  - position buckets
  - the trash batch with Sub-to-dos
- **REST**: status codes and error shapes for every endpoint; Token scope allow and deny, including `/mcp`.
- **Scheduler**: with a fake clock and a fake Telegram client, cover timer selection, the 5-minute cap, skipping past days, 1 s spacing, every row of §6.3, the late marker, redaction, `/healthz` going stale, and the delivery state.
- **Web**: shared schema round-trips, quick-add parsing, `@` matching, and day-label formatting.

## 10. Rollout

The owner does this (it is issue 15):

1. Add `OWNER_TIMEZONE`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to `/opt/tracker/.env` and to `deploy/.env.example` (with empty values).
2. Deploy with the `--ci` flow.
3. Create the `parla` token with `--scope todos`.
4. Check end to end: a To-do with a Reminder two minutes ahead arrives on Telegram, and its link opens the panel.

## 11. Out of scope (decided)

- MCP tools for To-dos (ADR 0017)
- tags
- recurring To-dos
- due dates or spans
- Gantt, board and calendar layouts (rejected in the prototype)
- more than one Reminder per To-do
- Reminders on another day than the Planned day
- Reminders on Issues
- Telegram buttons and inbound webhooks
- To-dos on Project pages
- To-dos in global search
- an activity log, comments and attachments on To-dos
- a queue in Parla when Traccia is unreachable
- syncing or aggregating work Issues

## 12. Build order

Milestone **P11 Personal Space**, one issue per step, done strictly in order (each one is blocked by the steps it needs):

1. To-do core: table, service, create/list/get, Owner timezone
2. Project references from titles
3. Edit and close To-dos, Sub-to-dos and the closing cascade
4. Manual order (Position)
5. Delete, restore, purge and Trash
6. Reminders in the API
7. Token scope `todos`
8. Reminder scheduler and Telegram delivery
9. Personal Space page and Today list
10. Quick add, `@` autocomplete and Project chips
11. Row actions and inline pickers
12. Details panel and deep link
13. Upcoming, Anytime, Logbook and By project lists, plus drag to reorder
14. Reminder failure badges and delivery banner
15. Production rollout (owner)
