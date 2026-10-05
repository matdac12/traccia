# Traccia dashboard (`apps/web`)

Next.js 16 (App Router, React 19, TypeScript strict), Tailwind 4, shadcn/ui, `output: "standalone"`. It runs on `omni`
behind `tailscale serve` (ADR 0007) and talks to `apps/api` over the compose network. The look is the approved
"Linear-calm" prototype in `prototypes/dashboard` (MAT-1686): re-implement from it, never import it.

## Run

```sh
# Terminal 1: the API (from apps/api; see deploy/README.md for env). Create a `you` token once:
pnpm --filter api tracker token create --name dashboard --actor you

# Terminal 2: the dashboard
cd apps/web
cat > .env.local <<'ENV'
TRACKER_API_URL=http://127.0.0.1:8787
TRACKER_API_TOKEN=trk_...
DASHBOARD_DEV_LOGIN=you@local
ENV
pnpm dev          # http://localhost:3000
```

| Variable | Required | Meaning |
|----------|----------|---------|
| `TRACKER_API_URL` | yes | API base URL, e.g. `http://api:8787`. |
| `TRACKER_API_TOKEN` | yes | A `you` token. Server only, never `NEXT_PUBLIC_`. |
| `DASHBOARD_ALLOWED_LOGINS` | yes in production | Comma-separated Tailscale logins (case-insensitive). |
| `DASHBOARD_DEV_LOGIN` | no | Local-development bypass of the access check. **Refused when `NODE_ENV=production`.** |

The env is validated with Zod at server start (`instrumentation.ts`, `lib/env.ts`): a bad env prints every problem
and exits with code 1.

Scripts: `pnpm dev`, `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm check:bundle`.
Dev and build use `--webpack` because `packages/shared` imports siblings as `./x.js` (NodeNext style) and Turbopack
cannot map that to `.ts` yet.

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
  the input schemas from `@linear-matti/shared` (parse them in the server action before sending).
- Failures throw `ApiError` (`status`, `code`, `details`). `code` is the API's error code (`not_found`, `conflict`,
  `validation_error`, ...) or `unreachable`, `bad_response`. For a stale write, `conflict` carries
  `details.currentUpdatedAt`; send the last seen `updatedAt` as `ifMatch`. Project, milestone and position writes take it as `expectedUpdatedAt` in the body instead (the API accepts either). In project-page server actions `toFailure` marks such a stale write with `conflict: true` (other 409s, like a duplicate label name, do not), and the panels show `components/traccia/conflict-notice.tsx` while keeping the user's draft.
- Lists return `{ items, nextCursor }`; pass `nextCursor` back as `cursor`.
- Kanban moves use `PATCH /issues/:id/position` with `{ status, beforeId?, afterId?, expectedUpdatedAt? }` (the board sends the card's `updatedAt`; a 409 rolls the move back); a column is (project, status).
  `beforeId` is the card the moved issue lands directly ABOVE, `afterId` the card it lands directly BELOW (verified
  against the service; the board sends the card above as `afterId`). Neighbours must share the issue's project.
  The board lives in `components/kanban/` (pure drop logic in `board-model.ts`) and lists columns by `sortOrder`.
- **Search snippets** (`GET /search`) contain `<mark>` around hits and are NOT HTML-escaped. Escape the whole string,
  then re-enable only `<mark>` and `</mark>`, before using it as HTML. Never `dangerouslySetInnerHTML` raw snippets.

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
- Dense rows (~36 px), hairline borders, no heavy shadows. Color appears only in status icons, priority, labels and
  the agent mark.
- **Design tokens** are CSS variables in `app/globals.css`, with light (`:root`) and dark (`.dark`) values. The accent
  is `--brand`, `--brand-foreground` and `--brand-ring`; `--primary`, `--ring` and `--sidebar-primary` derive from
  them. A selectable accent (MAT-1731) only has to override those three on `<html>`. Status colors (`--st-*`)
  and the agent color (`--agent`, cyan) are fixed and must not follow the accent.
- Theme: `next-themes`, system by default, toggle in the sidebar footer (System / Light / Dark).
- Every route group has `loading.tsx`, `error.tsx` and `not-found.tsx`; add them for new groups. Show an empty
  state (`EmptyState`) for empty lists, never a blank page.
- Domain words follow `GLOSSARY.md` (issue, status, actor, `you`, `agent`). The product name is Traccia; code
  identifiers stay `tracker`.

## Layout

```
proxy.ts               access check on every route
instrumentation.ts     env validation at startup
lib/access.ts          pure access decision
lib/env.ts             Zod env schema, pure (server-env.ts: server-only cached read)
lib/api/               server-only API client, response schemas, per-resource functions
lib/session.ts         current login for display
app/(app)/             shell layout + pages (issues, projects, trash)
components/ui/         shadcn primitives
components/traccia/    app components
components/issue-detail/  issue page (MAT-1721); lib/issue-detail/ holds its pure helpers
scripts/               check-client-bundle.mjs
test/                  vitest
e2e/                   Playwright smoke tests (support/ boots the API + dashboard)
```

## Project page and create-issue dialog

- `app/(app)/projects/[id]/page.tsx` loads the project, milestones (with `progress` done/total), labels and issues on
  the server; the panels in `components/project/*` are client components that call the server actions in
  `app/(app)/projects/[id]/actions.ts` (validate with the shared Zod schema, call `lib/api`, `revalidatePath`).
  Actions return `ActionResult` (`lib/action-result.ts`): `{ ok, data }` or `{ error, fieldErrors }` for inline errors.
- The issue list there is the shared `IssuesView` (MAT-1720) locked to the project (`lockProject`), with filters in the page URL.
- `components/create-issue/` is reusable: `CreateIssueProvider` (mounted in the `(app)` layout) exposes
  `useCreateIssue().open({ projectId?, status? })` and binds the `C` shortcut. Labels and milestones load per project
  through `loadCreateIssueOptions`. The create route has no `labels` field, so labels are set with a follow-up PATCH; if only
  that step fails the issue still exists and the dialog says so instead of failing the whole create.
- Labels are managed on the project page (project-scoped or global). Deleting a label is permanent and dashboard-only.

## Issue detail (`/issues/[identifier]`, MAT-1721)

`app/(app)/issues/[identifier]/` (page + `actions.ts`) and `components/issue-detail/`. The page fetches the issue with
`?include=comments,activity,attachments,children,relations`. Every edit is a server action that sends the issue's
`updatedAt` as `If-Match`; a `conflict` returns the current issue, nothing is saved, and the UI offers "Re-apply my
change" (patches are rebuilt against the fresh issue, and title/description are refused if the same field moved).
Markdown goes through `components/issue-detail/markdown.tsx` (react-markdown + rehype-sanitize); always use it for
agent-written text. Attachments live in `components/issue-detail/attachments.tsx` (see "Files" below).
The API's search matches whole words only, so the blocker/parent picker looks `MAT-12`-style input up directly.

## Browser smoke tests (`pnpm test:e2e`, MAT-1736)

Playwright (headless Chromium) clicks through the real dashboard. `pnpm test` stays fast and does not run it.

```sh
pnpm install
pnpm --filter web exec playwright install chromium   # once per machine
pnpm --filter web test:e2e                           # about 1-3 minutes (dev server compiles routes)
```

`e2e/global-setup.ts` starts everything itself: the API (`tsx src/main.ts`) on a fresh SQLite database in the OS
temp dir, a `you` token created through the `tracker` CLI (held in memory, never printed or written), seed data
(one project `SMK`), and `next dev` on `127.0.0.1:3100`. Everything is stopped and the database deleted afterwards.
It needs no `.env` and touches no real data. Ports: `E2E_WEB_PORT` (3100), `E2E_API_PORT` (8799). Stop any other
`next dev` in `apps/web` first (Next allows one dev server per directory).

The dashboard runs with `DASHBOARD_ALLOWED_LOGINS=e2e@local` and the browser sends that `Tailscale-User-Login`
header (ADR 0008), so the same run proves the 403 for a missing or unknown login. The dev-login bypass is not used.

Scenarios (`e2e/smoke.spec.ts`, run serially, each on its own uniquely titled issue): project list in the shell;
create an issue from the dialog; change status in the detail page; drag a Kanban card and reload; upload and preview
an image; delete an issue and restore it from Trash; the 409 conflict banner (the page's live refresh is blocked,
the issue is changed through the API, then the stale page edits it); 403 without the identity header; light and
dark theme (checks the `dark` class and background luminance, and attaches a screenshot to the report; not a pixel
comparison).

`next dev` serves HTML before React hydrates, so `visit()` waits for hydration (reloading if the bundle came out
half-compiled) before a test clicks. Failure traces and screenshots land in `e2e/.results/` (git-ignored).

## Docker

`docker buildx build --platform linux/amd64 --load -f apps/web/Dockerfile -t tracker-web:latest .` from the repo
root; the image runs `node apps/web/server.js` (standalone). Env comes from compose (`deploy/docker-compose.yml`).

## Files (attachments, MAT-1725)

The browser has no token, so files go through two route handlers (both covered by `proxy.ts`, both streaming, nothing buffered):
`GET|HEAD /api/files/[id]` (from `GET /v1/files/:id`; passes `Content-Type`, `Content-Disposition`, `Content-Length`,
`ETag`; forces `nosniff`; 404 for unknown ids; no Range, the API has none) and
`POST /api/issues/[identifier]/attachments` (multipart passthrough to the API, which enforces the size cap and the
allowed types; its error shape is returned unchanged). Delete and undo are server actions (soft delete, restore from Trash).
`lib/attachments.ts` holds the pure helpers (ULID check, size and type pre-check that mirrors the API's defaults).
Markdown images: `markdown.tsx` rewrites `<BASE_URL>/files/<id>` (what MCP `create_attachment` writes) to
`/api/files/<id>` in a rehype plugin that runs before `rehype-sanitize`; every other image is dropped.
