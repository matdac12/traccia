# Traccia dashboard (`apps/web`)

Next.js 16 (App Router, React 19, TypeScript strict), Tailwind 4, shadcn/ui, `output: "standalone"`. It runs on `<your-server>`
behind `tailscale serve` (ADR 0007) and talks to `apps/api` over the compose network. The look is the approved
"Linear-calm" prototype in `prototypes/dashboard` (TRC-12): re-implement from it, never import it.

## Run

```sh
# Terminal 1: the API (from apps/api; see deploy/README.md for env). Create a `you` token once:
pnpm --filter api traccia token create --name dashboard --actor you

# Terminal 2: the dashboard
cd apps/web
cat > .env.local <<'ENV'
TRACCIA_API_URL=http://127.0.0.1:8787
TRACCIA_API_TOKEN=trk_...
DASHBOARD_DEV_LOGIN=you@local
ENV
pnpm dev          # http://localhost:3000
```

| Variable | Required | Meaning |
|----------|----------|---------|
| `TRACCIA_API_URL` | yes | API base URL, e.g. `http://api:8787`. |
| `TRACCIA_API_TOKEN` | yes | A `you` token. Server only, never `NEXT_PUBLIC_`. |
| `DASHBOARD_ALLOWED_LOGINS` | yes in production | Comma-separated Tailscale logins (case-insensitive). |
| `DASHBOARD_DEV_LOGIN` | no | Local-development bypass of the access check. **Refused when `NODE_ENV=production`.** |
| `OWNER_TIMEZONE` | no | IANA zone where a day starts and ends in the Personal Space (`/personal`), default `Europe/Rome`. Set it to the API's value; an unknown zone fails startup. |

The env is validated with Zod at server start (`instrumentation.ts`, `lib/env.ts`): a bad env prints every problem
and exits with code 1.

Scripts: `pnpm dev`, `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm check:bundle`.
Dev and build use `--webpack` because `packages/shared` imports siblings as `./x.js` (NodeNext style) and Turbopack
cannot map that to `.ts` yet.

**HMR in headless browsers (TRC-85):** Next handles the `/_next/webpack-hmr` websocket upgrade in its HTTP server, not
through `proxy.ts`, so the access check should not see it and no exclusion was added. The QA report
(`ERR_INVALID_HTTP_RESPONSE`) is unconfirmed; I could not tell whether `DASHBOARD_DEV_LOGIN` was set. For `pnpm dev`
set it, or test against `next build` + `next start` with the `Tailscale-User-Login` header. Reopen if it still fails
with the bypass set.

## Access check (ADR 0008)

`proxy.ts` (Next 16's name for middleware) runs on **every** request: pages, server actions, route handlers and
`/api/*` (matcher `/:path*`, no exclusions). It compares the `Tailscale-User-Login` header with
`DASHBOARD_ALLOWED_LOGINS`. A missing header or another login gets a 403 (HTML page; JSON under `/api`).

The header can be trusted only because the service listens on localhost behind `tailscale serve`, which sets it.
Another local process on the host could forge it; v1 accepts that. Never publish port 3000 any other way.
The logic is pure and lives in `lib/access.ts`; `test/access.test.ts` covers it and the proxy.

## Talking to the API

All data access happens on the server. `lib/api/client.ts` starts with `import "server-only"`, so importing it
(or anything built on it, such as `lib/api/projects.ts`) from a client component fails the build. The token therefore
cannot end up in the browser. `pnpm check:bundle` builds with a sample token and greps `.next/static` for the variable
names and the token value; run it before changing anything around the client.

- Add one function per resource in `lib/api/<resource>.ts`, calling `api().request(path, { schema, query, body, method })`.
  The path is relative to `/v1`. Responses are parsed with a Zod schema from `lib/api/schemas.ts`; request bodies use
  the input schemas from `@traccia/shared` (parse them in the server action before sending).
- Failures throw `ApiError` (`status`, `code`, `details`). `code` is the API's error code (`not_found`, `conflict`,
  `validation_error`, ...) or `unreachable`, `bad_response`. For a stale write, `conflict` carries
  `details.currentUpdatedAt`; send the last seen `updatedAt` as `ifMatch`. Project, milestone and position writes take it as `expectedUpdatedAt` in the body instead (the API accepts either). In project-page server actions `toFailure` marks such a stale write with `conflict: true` (other 409s, like a duplicate label name, do not), and the panels show `components/traccia/conflict-notice.tsx` while keeping the user's draft. The project header (`components/project/project-title.tsx`, `project-delete.tsx`) renames inline (the key is read-only, ADR 0002) and soft-deletes with an Undo notice; delete deliberately does not revalidate, because re-rendering the deleted project's page would 404 over the notice (same as issue delete).
- **Request budget (TRC-86):** `/issues` loads in three API requests: `GET /issues/groups` (one page per status plus the `syncToken`), `GET /projects?include=milestones` and `GET /labels`. `listProjects` is wrapped in React `cache`, so the layout's sidebar and the page share one fetch per render. The live refresh (`refreshIssueGroups`) is one `/issues/groups` request, plus follow-ups only for groups whose "load more" was opened. "Load more" on a single group still uses `GET /issues`. The project sub-routes (TRC-97) share one `GET /projects/:id` between layout and page (`getProject` is `cache`d). Their reads run together (TRC-107): the project-scoped calls use the route's reference (id, name or key), so none waits on `getProject`, and `getProjectOr404` still decides not-found first. Because `listProjects?include=milestones` (shared with the sidebar) already carries every project's milestones, Activity and Issues derive the current project's milestones from it instead of calling `/projects/:id/milestones` again (Overview still fetches them directly for its panel). So Overview adds milestones and labels, Activity adds only `/activity?project=` plus the (shared) project list, and Issues adds labels, the groups (or board columns) and the (shared) project list.
- Lists return `{ items, nextCursor }`; pass `nextCursor` back as `cursor`.
- Kanban moves use `PATCH /issues/:id/position` with `{ status, beforeId?, afterId?, expectedUpdatedAt? }` (the board sends the card's `updatedAt`; a 409 rolls the move back); a column is (project, status).
  `beforeId` is the card the moved issue lands directly ABOVE, `afterId` the card it lands directly BELOW (verified
  against the service; the board sends the card above as `afterId`). Neighbours must share the issue's project.
  The board lives in `components/kanban/` (pure drop logic in `board-model.ts`) and lists columns by `sortOrder`.
- **Search snippets** (`GET /search`) are plain-text segments (`{ text, match }[]`), not HTML and never
  escaped by the API. Render `text` as a React child (or escape it if you must build a string); mark the
  `match` segments yourself. Never `dangerouslySetInnerHTML` a snippet.

## Server components, server actions, route handlers

- **Reads: server components.** Fetch in the page or layout (`async` component) and pass plain data down. The `(app)`
  layout is `force-dynamic`: every page needs the request's identity and live data.
- **Writes from the UI: server actions** (`"use server"` files next to the feature, e.g. `app/(app)/issues/actions.ts`).
  Validate input with the shared Zod schema, call `lib/api`, then `revalidatePath`. They are covered by the proxy.
- **Route handlers (`app/api/**/route.ts`) only when a client needs data it cannot get from a server component**
  (for example polling for live updates). Keep them thin wrappers over `lib/api`, and return the API's error shape.
- Never fetch the API from a client component, and never put the token in a prop.

## Components and styling

- `components/ui/*`: shadcn/ui primitives (new-york, neutral base, CSS variables, lucide icons). Add more with
  the shadcn CLI or copy from the prototype; imports use `@/lib/utils`.
- `components/traccia/*`: app components (shell, `StatusIcon`, `ActorAvatar`, `AgentMark`, `PageHeader`, `EmptyState`).
  Client components only where state or events need them (`"use client"` at the top); the shell is the only big one.
- Dense rows (~38 px), hairline borders, no heavy shadows. Color appears only in status icons, priority, labels and
  the agent mark.
- **Issues table rows.** Sub-issues are nested under their parent when both are in the same section (`nestRows` in
  `components/issues-table/group-rows.ts`), with tree connectors; a sub-issue whose parent is in another section keeps
  the `↳ TRC-n` marker. A cyan dot at the row's left edge marks every issue the agent created. Below 768 px a row is
  two lines (status and title, up to three lines / identifier, updated, markers, labels, assignee) instead of a 860 px wide
  table, and the Milestone and Est. columns are hidden; from 768 px it is one flat line, with `md:order-*` classes
  placing the cells in column order.
- **List hierarchy and issue peek.** Titles lead, identifiers are quiet, and coloured-dot label chips show up to two
  labels plus `+N` (all remain editable). Orange blocker badges identify unresolved blockers; hover or keyboard focus
  shows their titles. Done, canceled and deleted blockers do not count. Summaries are batched in the list service,
  including grouped/paginated responses, without per-row detail requests. Display controls toggle Milestone, Assignee,
  Estimate and Updated columns; all start visible and choices stay in memory for the current view.
  An ordinary row click opens an editable right-side peek without changing the URL or list state. Other rows remain
  selectable; Escape or Close restores focus to the invoking link. Modified clicks and Full issue retain full-page
  navigation. Mobile uses a viewport-width panel. Details load only on selection, share the full page's editor and
  stale-write handling, and keep activity/comments collapsed. The selected prototype was A; the throwaway variants
  are captured on local branch `prototype/list-layouts-2026-10-13`, not imported by production code.
- **Design tokens** are CSS variables in `app/globals.css`, with light (`:root`) and dark (`.dark`) values. The accent
  is `--brand`, `--brand-foreground` and `--brand-ring`; `--primary`, `--ring` and `--sidebar-primary` derive from
  them. The selectable accent (TRC-57) overrides just those three. Status colors (`--st-*`)
  and the agent color (`--agent`, cyan) are fixed and must not follow the accent.
- **Collapsible sidebar (TRC-98).** On desktop (>= 768 px) the sidebar in `components/traccia/app-shell.tsx` collapses to a 48 px icon rail (button in its header, or Cmd/Ctrl+B outside text fields and open dialogs/menus) and expands again. The choice is the `traccia_sidebar` cookie (`lib/sidebar-state.ts`); the `(app)` layout reads it and passes `defaultCollapsed`, so the first paint already has the right width. The rail keeps every control and its accessible name (labels become `sr-only`) and shows a tooltip per icon. The mobile drawer always renders the full list and ignores the choice. It is a small extension of the existing shell, not a port of the prototype's shadcn `Sidebar`.
- **Appearance settings (TRC-57).** `/settings` picks the accent (10 curated colors or a free hex) and the UI font (Geist Mono default, Geist Sans, System). Choices are the `traccia_accent` and `traccia_font` cookies (`lib/appearance.ts`, pure and unit-tested); the root layout reads them, so the first paint has no flash. `AppearanceProvider` renders a `<style>` overriding the three brand variables in `:root` and `.dark`, and sets `data-font` on `<html>`; `globals.css` maps `font-sans` to `--app-font-sans`, which `data-font` switches (`font-mono` for code stays Geist Mono). A hex with under 2:1 contrast against a theme's background is moved toward black (light) or white (dark) in that theme only, and the page warns. Text on the accent is chosen for 4.5:1.
- Theme: `next-themes`, system by default, toggle in the sidebar footer (System / Light / Dark).
- Every route group has `loading.tsx`, `error.tsx` and `not-found.tsx`; add them for new groups. Show an empty
  state (`EmptyState`) for empty lists, never a blank page.
- Domain words follow `GLOSSARY.md` (issue, status, actor, `you`, `agent`). The product name is Traccia, and
  so are the code identifiers (package scope `@traccia`, CLI `traccia`).

## Layout

```
proxy.ts               access check on every route
instrumentation.ts     env validation at startup
lib/access.ts          pure access decision
lib/env.ts             Zod env schema, pure (server-env.ts: server-only cached read)
lib/api/               server-only API client, response schemas, per-resource functions
lib/session.ts         current login for display
app/(app)/             shell layout + pages (issues, projects, trash, personal)
components/ui/         shadcn primitives
components/traccia/    app components
components/personal/   Personal Space page (TRC-159); lib/personal/ holds its pure helpers
components/issue-detail/  issue page (TRC-47); lib/issue-detail/ holds its pure helpers
scripts/               check-client-bundle.mjs
test/                  vitest
e2e/                   Playwright smoke tests (support/ boots the API + dashboard)
```

## Project page and create-issue dialog

The project page (TRC-97) is three sub-routes under one layout, so the tab is real navigation (URL, reload and Back keep it):
`/projects/[id]` Overview, `/projects/[id]/activity` Activity, `/projects/[id]/issues` Issues. `app/(app)/projects/[id]/layout.tsx` holds
the header (rename, key, status, delete with Undo, New issue) and `components/project/project-tabs.tsx` (a `nav` of links with
`aria-current="page"`, not a `tablist`: nothing swaps in place). `getProject` is wrapped in React `cache`, so the layout and the page share one fetch.
Project server actions revalidate `/projects/<id>` with type `"layout"` so the header and all three tabs refresh together.

- **Overview** loads the project, its milestones (with `progress` done/total) and labels, and no issues. Left column: the description
  (`project-description.tsx`: the shared sanitised `Markdown`, collapsed to about five lines with a fade; the "Show more / Show less" button
  (`aria-expanded`) only exists when the text really overflows, is measured with a `ResizeObserver`, and sits over the fade so it adds no height;
  Edit stays an inline editor) and the milestone list (`milestones-panel.tsx` + `milestone-row.tsx`: status dot, name, percent, issue count, one-line
  description and target date; the name links to `/projects/<id>/issues?milestone=<id>`; Edit/Delete show on hover or focus and always on touch).
  Dot semantics: not started = nothing done or no issues, in progress = partly done, done = all done (`milestoneState`). Right rail: `ProgressSummary`
  (all milestone issues rolled up; issues outside a milestone are not counted) and labels.
- **Issues** is the shared `IssuesView` (TRC-46) locked to the project (`lockProject`), table and board, with filters in this page's URL.
- **Activity** is `GET /v1/activity?project=` (id, name or key), newest first, with "Load more" through the dashboard's `GET /api/activity?project=&cursor=` route handler (TRC-105). It does not live-refresh.
- Panels in `components/project/*` are client components that call the server actions in
  `app/(app)/projects/[id]/actions.ts` (validate with the shared Zod schema, call `lib/api`, `revalidatePath`).
  Actions return `ActionResult` (`lib/action-result.ts`): `{ ok, data }` or `{ error, fieldErrors }` for inline errors.
- **List filters and display (TRC-83).** `lib/issue-filters.ts` holds all list state in the URL: `status` (repeatable, empty = all; the table and the board only fetch the chosen statuses), `group` (`status` default, `none`, `priority`, `assignee`, `project`, `milestone`; table only) and `sort` (now also `title`). Any grouping other than status pools the rows loaded so far (per-status pages) and re-sorts them client-side (`group-rows.ts`), with one "Load more" per status below. Sub-issue markers (parent identifier, finished/total) are computed from the loaded rows only. Estimate is not sortable yet (nullable cursor in the API).
- `components/create-issue/` is reusable: `CreateIssueProvider` (mounted in the `(app)` layout) exposes
  `useCreateIssue().open({ projectId?, status? })` and binds the `C` shortcut. Labels and milestones load per project
  through `loadCreateIssueOptions`. The create route has no `labels` field, so labels are set with a follow-up PATCH; if only
  that step fails the issue still exists and the dialog says so instead of failing the whole create.
- `components/project/new-project-button.tsx` is the "New project" dialog (projects page header and the sidebar's Projects "+"). `createProjectAction` (`app/(app)/projects/actions.ts`) omits the key (shared, ADR 0002), revalidates the layout so the sidebar updates, and the dialog navigates to the new project.
- Labels are managed on the project page (project-scoped or global). Deleting a label is permanent and dashboard-only.

## Issue detail (`/issues/[identifier]`, TRC-47)

`app/(app)/issues/[identifier]/` (page + `actions.ts`) and `components/issue-detail/`. The page fetches the issue with
`?include=comments,activity,attachments,children,relations`. Every edit is a server action that sends the issue's
`updatedAt` as `If-Match`; a `conflict` returns the current issue, nothing is saved, and the UI offers "Re-apply my
change" (patches are rebuilt against the fresh issue, and title/description are refused if the same field moved).
Markdown goes through `components/issue-detail/markdown.tsx` (react-markdown + rehype-sanitize); always use it for
agent-written text. Attachments live in `components/issue-detail/attachments.tsx` (see "Files" below).
The API's search prefix-matches the last word (so `perch` finds `perché`); the blocker/parent picker also looks `MAT-12`-style input up directly.

## Personal Space (`/personal`, TRC-159)

Spec: `docs/personal-space.md` §7. The page is `app/(app)/personal/page.tsx`; its components live in
`components/personal/` and the pure helpers in `lib/personal/` (`days.ts` for Planned days in the Owner timezone,
`lists.ts` for what each list shows and the menu counts, `title.ts` for Project chips, `quick-add.ts` for the quick-add
parser, `project-autocomplete.ts` for `@` matching, `todo-changes.ts` for the optimistic copy of a write). "Personal" (lucide `Sun`) is the first sidebar item, above Issues.

- **Data.** `loadPersonalSpace` (`lib/api/todos.ts`) dates today in `OWNER_TIMEZONE`, then reads every open To-do
  (`GET /todos?state=open`, following `nextCursor`) and the Logbook only as far back as today
  (`GET /todos?state=closed`, newest first). Two requests, plus one per extra page. The page renders it on the server;
  the live refresh (TRC-52) polls the same function through `GET /api/todos`, so a page left open across midnight
  rolls over to the new day on its next refresh. The page also passes the live Projects (`listProjects`, shared
  with the layout through React `cache`) to `projects-context.tsx`, for `@` autocomplete and chip tooltips; the poll
  doesn't re-read them.
- **Quick add (TRC-160).** `quick-add.tsx` sits at the top of Today (its `defaultDay` prop is the day a line with no
  day word goes to; `null` is Anytime). It parses `@KEY`, a day word and `HH:MM`, shows a read-back line, and posts
  through `createTodoAction` (`app/(app)/personal/actions.ts`), which revalidates `/personal` so the new To-do shows in
  the same round trip. API errors (a Reminder time already past) show under the field. `mention-input.tsx` is the
  `@` autocomplete input (an ARIA combobox) that title editing and the Sub-to-do input reuse.
- **Project chips.** A chip links to `/projects/:id` with an "Open <name>" tooltip and stops the click, so it never
  selects the row; a chip whose Project is deleted is greyed and not a link. A key that names several Projects links
  to the first one the API lists.
- **Sub-to-do counts.** The row's `n/m` is the API's `subTodos` (TRC-177): `done` of `total`, dropped ones left out
  of both, `null` on a Sub-to-do. A parent without live Sub-to-dos (`{0,0}`) shows no count.
- **Row actions (TRC-161).** Every write goes through `useTodoWrites` (`todo-actions.tsx`), which `personal-space.tsx`
  provides to the rows as `useTodoActions()`: `update(todo, patch)`, `move(todo, move)` (drag, TRC-163) and
  `deleteTodo(todo)`.
  - It shows the write at once with React's `useOptimistic` and `applyTodoChange`, the API's update rules applied
    locally. It sends the row's `updatedAt` as `expectedUpdatedAt`. A refusal (a 409 `conflict` included) rolls the
    row back, with the error under it.
  - It asks before two writes. Moving a To-do with a Reminder to Anytime asks first. Closing a parent asks on the
    API's 409 `openSubTodos` and retries with `closeSubTodos: true`. A parent the counts show has open Sub-to-dos isn't
    closed optimistically, so cancelling leaves it open.
  - The server actions are `updateTodoAction`, `moveTodoAction` (`PATCH /todos/:id/position`) and `deleteTodoAction`
    (`app/(app)/personal/actions.ts`). All revalidate `/personal`. Delete goes to the Trash with no confirm.
  - The row's check waits about 300 ms for the strike to draw before it writes (no wait under reduced motion).
  - `DayPicker` (`day-picker.tsx`) and `ReminderPicker` (`reminder-picker.tsx`) are Radix Popovers. They take any
    trigger and only report the choice, so the details panel (TRC-162) can reuse them. Their bodies mount only while
    open.
  - The Reminder picker reads "now" in the Owner timezone (`PersonalSpaceData.timeZone`) when it opens, and disables
    the moments already past. The "…" menu (`todo-menu.tsx`) offers Move to, Reminder, Mark done, Drop, Reopen and
    Delete, as the single-pointer alternative to drag.
- **Reminder failures and the delivery banner (TRC-164).** `lib/personal/delivery.ts` holds the plain-words text for each
  `failure` (`FAILURE_TEXT`), the "Skipped (day had passed)" note, and the three banner texts. A failed Reminder shows
  red with a crossed bell and a tooltip naming the reason; a skipped one is dimmed; the details panel repeats the
  sentence. `loadPersonalSpace` also reads `GET /todos/delivery` (`getDelivery`), so the page and its poll carry
  `delivery`, and `DeliveryBanner` shows above the list unless `ok`. A delivery read that fails leaves the banner out
  (a poll keeps the last state shown). A new time in the Reminder field re-arms a failed Reminder to pending.
- **Details panel (TRC-162).** The selected To-do lives in the URL, `/personal?todo=<id>` (the link in every Telegram
  Reminder and the API's `url`), next to the list shown (`?list=`, below). `usePersonalUrl` (`selection.tsx`) reads
  both with `useSearchParams` and changes them with `history.pushState`, which Next's router follows with no server
  round trip, so back and forward move between lists and selections.
  - A row selects itself through an "Open" button stretched under it; the check, the Reminder time, the day, the "…"
    menu and the chips sit above it (`relative z-[1]`), so a click on them never selects.
  - `loadPersonalSpace(now, todoId)` (the page, and the poll as `GET /api/todos?todo=<id>`) adds `selected`: the
    To-dos the panel needs that the lists don't load (it, its Sub-to-dos from `GET /todos/:id/sub-todos`, or its
    parent, when closed on an earlier day). A To-do `GET /todos/:id` doesn't find, or finds deleted, is in neither,
    and the panel says it no longer exists. `personal-space.tsx` merges those into the one `useTodoWrites` set; the
    lists filter what they show themselves (Today's closed section by close day). The poll asks for `?todo=` only while the lists alone leave the panel short, and such
    a selection is read at once rather than at the next poll (`usePoll` runs a `refresh()` that lands mid-poll as
    soon as that poll ends).
  - `details-panel.tsx` is a 340 px column from 1180 px and a dialog below; `todo-details.tsx` is its body (title
    with `MentionInput`, the row's day and Reminder pickers, Details saved on blur, Sub-to-do rows and "Add a
    Sub-to-do", which is `QuickAdd` with a `parentId`). Title and Details edits are local state, so the poll and the
    revalidation after a write never reset them.
- **Lists (TRC-163).** The list menu (`list-menu.tsx`) is a column on a laptop and a scrolling strip below `md`. The
  chosen list is `?list=` (`today`, left out when nothing is selected, `upcoming`, `anytime`, `logbook`,
  `project:KEY`); a row's selection writes it too. A link with only `?todo=` opens over the list `listOf`
  (`lib/personal/lists.ts`) picks (Today for today and Overdue, Upcoming for a later day, Anytime, the Logbook once
  closed, an undated Sub-to-do over its parent's), and the page then writes that list into the same history entry
  (`replaceState`), so it stays put while the To-do changes and back/forward return to it.
  - Each list is a pure helper in `lists.ts` and a component: `todayList` / `today-list.tsx` (closed rows only when
    closed today in the Owner timezone), `upcomingList` / `upcoming-list.tsx` (the next 14 days, empty ones dimmed,
    then "Later" by day), `anytimeList` / `anytime-list.tsx` (each parent's open Sub-to-dos indented under a left
    rule), `projectTodos` / `project-list.tsx`, and `logbookList` / `logbook-list.tsx`.
  - **Logbook.** `useLogbook` reads its own pages through `GET /api/todos/logbook?cursor=` (`listLogbookPage`, 50 a
    page, newest first): the first when the list shows, the next when its end scrolls into view (or "Show older").
    The poll never re-reads them. Its To-dos closed today come from the poll, which wins for them; a write's answer
    updates the held copy (a reopened To-do leaves), and a new day starts over. Nothing older than the last loaded
    page shows, so a deep-linked old To-do doesn't open a gap.
  - **Drag to reorder** (`sortable-rows.tsx`, dnd-kit) in Today and Anytime: a handle on hover left of the check
    (from `md` up), `KeyboardSensor` for the keyboard. A row moves only within its bucket (one Planned day or Anytime,
    under one parent): while it is dragged the other buckets' rows are disabled as drop targets, and `dropMove`
    (`todo-changes.ts`) names its new neighbour in that bucket (`afterId`, or `beforeId` at the top). It goes
    through `useTodoWrites` like any edit, so it shows at once and rolls back with an error under the row.

## Browser smoke tests (`pnpm test:e2e`, TRC-61)

Playwright (headless Chromium) clicks through the real dashboard. `pnpm test` stays fast and does not run it.

```sh
pnpm install
pnpm --filter web exec playwright install chromium   # once per machine
pnpm --filter web test:e2e                           # about 40 s (production build + tests)
```

`e2e/global-setup.ts` starts everything itself: the API (`tsx src/main.ts`) on a fresh SQLite database in the OS
temp dir, a `you` token created through the `traccia` CLI (never printed or written to disk; the dashboard server and the workers receive it through their environment), seed data
(one project `SMK`), and the dashboard as a **production build** on `127.0.0.1:3100`. It runs `next build --webpack`
once, then the standalone server (`.next/standalone/apps/web/server.js`, the same runtime as the Docker image).
Everything is stopped and the database deleted afterwards. It needs no `.env` and touches no real data. Ports:
`E2E_WEB_PORT` (3100), `E2E_API_PORT` (8799); override both when another run holds them. Stop any other Next
server (`pnpm dev`) in `apps/web` first: the build takes the `.next` directory lock.

The production build is what makes the suite deterministic (TRC-100). `next dev` compiles each route on its first
visit, and under load that compilation overran assertion timeouts, so the same scenario could pass or fail run to
run. A precompiled bundle removes the per-route compile; the whole suite is also faster than the old dev runs.

The dashboard runs with `DASHBOARD_ALLOWED_LOGINS=e2e@local` and the browser sends that `Tailscale-User-Login`
header (ADR 0008), so the same run proves the 403 for a missing or unknown login. The dev-login bypass is not used.

Scenarios (`e2e/smoke.spec.ts`, run serially, each on its own uniquely titled issue): project list in the shell;
create an issue from the dialog; change status in the detail page; drag a Kanban card and reload; upload and preview
an image; delete an issue and restore it from Trash; the 409 conflict banner (the page's live refresh is blocked,
the issue is changed through the API, then the stale page edits it); 403 without the identity header; light and
dark theme (checks the `dark` class and background luminance, and attaches a screenshot to the report; not a pixel
comparison).

The server sends HTML before React hydrates, so `visit()` waits for hydration before a test clicks. Failure traces
and screenshots land in `e2e/.results/` (git-ignored).

## Inline edit (table rows and board cards, TRC-78)

`components/inline-edit/`: `StatusPicker`, `PriorityPicker`, `AssigneePicker`, `LabelsPicker` (dropdowns, same options as the detail panel) and
`useInlineEdit`, which saves through the detail page's `updateIssueAction` with the row's `updatedAt` as `If-Match`. The change shows at once;
a failure restores the row, a conflict swaps in the current issue and `InlineEditNotice` offers "Re-apply my change" (the patch is rebuilt against
the fresh row). `upsertRow` puts the saved row back into the table groups or board columns (a status change moves it). The live refresh is
refused while a save is in flight. Table rows are a link overlay with the pickers above it; on cards the pickers stop key events so Space/Enter
never starts a keyboard drag.

## Issue context menu (table rows and board cards, TRC-87)

`components/issue-menu/`: `IssueContextMenu` wraps a row or card (it becomes the Radix context-menu trigger, so right-click, touch long-press and
Shift+F10 / the context-menu key on a focused child work) and `IssueMenuButton` is the "..." button, which dispatches a `contextmenu` event so there is
one menu. Status, Priority, Assignee and Labels reuse the option builders in `components/inline-edit/options.tsx` (shared with the dropdown pickers) and
save through `useInlineEdit`, so optimistic updates and the conflict notice are the same. Project and Milestone patch the same fields as the detail page;
Set parent uses `IssuePicker`, Add sub-issue calls `createSubIssueAction`. Delete is a soft delete via `useIssueDelete` (row leaves at once, failure
restores it, notice offers Undo). The menu, submenus and dialogs stop key and pointer events from reaching a board card's drag listeners.
Not done: single-key shortcuts (S/P/A/L) on a focused row.

## Board polish (TRC-85)

A board card opens its issue on a click anywhere on it except its own controls (links, buttons, pickers, the "..." menu, and anything rendered in a portal); a click that ends a drag or selects text is ignored, and Cmd/Ctrl/Shift-click opens a new tab. Each column header has a "+" that opens the create dialog with that status (and the project, on a project page); it uses `useOptionalCreateIssue`, so a board rendered outside the provider simply has no "+". A fade on the right edge shows when columns are scrolled out of view. Trash folds an issue's comments and attachments deleted in the same batch into the issue's row (`groupedRows`), except when the list is filtered to one type. A Sub-to-do deleted in the same batch as its parent To-do always folds into the parent's row, filtered or not (TRC-155).

## Docker

`docker buildx build --platform linux/amd64 --load -f apps/web/Dockerfile -t traccia-web:latest .` from the repo
root; the image runs `node apps/web/server.js` (standalone). Env comes from compose (`deploy/docker-compose.yml`).

## Files (attachments, TRC-51)

The browser has no token, so files go through two route handlers (both covered by `proxy.ts`, both streaming, nothing buffered):
`GET|HEAD /api/files/[id]` (from `GET /v1/files/:id`; passes `Content-Type`, `Content-Disposition`, `Content-Length`,
`ETag`; forces `nosniff`; 404 for unknown ids; no Range, the API has none) and
`POST /api/issues/[identifier]/attachments` (multipart passthrough to the API, which enforces the size cap and the
allowed types; its error shape is returned unchanged). Delete and undo are server actions (soft delete, restore from Trash).
`lib/attachments.ts` holds the pure helpers (ULID check, size and type pre-check that mirrors the API's defaults).
Markdown images: `markdown.tsx` rewrites `<BASE_URL>/files/<id>` (what MCP `create_attachment` writes) to
`/api/files/<id>` in a rehype plugin that runs before `rehype-sanitize`; every other image is dropped.
