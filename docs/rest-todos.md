# REST: To-dos

The Personal Space's To-dos (spec: [personal-space.md](personal-space.md), terms: the "Personal Space" section of [GLOSSARY.md](../GLOSSARY.md)). They are reachable over REST only, never MCP ([ADR 0017](adr/0017-todos-are-not-issues.md)). All routes live under `/v1` and need a bearer token. Request and response schemas are in `packages/shared/src/todo-schemas.ts`.

## The To-do object

Every route returns To-dos in this shape:

- `id`, `title` (as typed, `@KEY`s included), `details` (markdown or `null`).
- `day`: the Planned day, `YYYY-MM-DD` in the Owner timezone (`OWNER_TIMEZONE`), or `null` for Anytime.
- `reminder`: `{ time, status, failure, sentAt }` or `null`. Always `null` for now; Reminders arrive in a later step.
- `references`: the Project references derived from the title, `{ key, projectId, projectDeleted }`. Always `[]` for now.
- `state`: `open`, `done` or `dropped`. `closedAt` is set while it is done or dropped.
- `parentId`: the parent of a Sub-to-do, else `null`. `position`: the manual order within its bucket (one Planned day, or Anytime, under one parent).
- `source`: the name of the Token that created it (e.g. `parla`), copied at creation so revoking the Token keeps it.
- `url`: `<BASE_URL>/personal?todo=<id>`, which opens it in the dashboard.
- `createdAt`, `updatedAt`, and `deleted: true` only on a deleted To-do.

## Routes

- `POST /v1/todos` with `{ title, day?, details? }` returns `201` and the To-do. `title` is trimmed and must be 1 to 500 characters; `day` is `YYYY-MM-DD` (a real date) or `null`. The new To-do is open and goes to the bottom of its bucket.
- `GET /v1/todos?state=open`: every open To-do as one flat list, Sub-to-dos included, ordered by `day` (Anytime last), then `position`, then `id`.
- `GET /v1/todos?state=closed`: the Logbook, done and dropped To-dos, most recently closed first.
- Both lists take `limit` (default 50, at most 250), `cursor` (the previous page's `nextCursor`) and `includeDeleted=true`, and return `{ items, nextCursor }`. `state` is required. A cursor only continues the list it came from.
- `GET /v1/todos/:id` returns one To-do, a deleted one included.

## Errors

The standard body `{ error: { code, message, details } }`. A bad request is `400 validation_error` with `details.fields` naming each field: an empty or over-long `title`, a malformed `day`, a missing or unknown `state`, a bad `limit`, `includeDeleted` or `cursor`, or a body that is not JSON. An unknown id is `404 not_found`.
