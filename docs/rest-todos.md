# REST: To-dos

The Personal Space's To-dos (spec: [personal-space.md](personal-space.md), terms: the "Personal Space" section of [GLOSSARY.md](../GLOSSARY.md)). They are reachable over REST only, never MCP ([ADR 0017](adr/0017-todos-are-not-issues.md)). All routes live under `/v1` and need a bearer token. Request and response schemas are in `packages/shared/src/todo-schemas.ts`.

## The To-do object

Every route returns To-dos in this shape:

- `id`, `title` (as typed, `@KEY`s included), `details` (markdown or `null`).
- `day`: the Planned day, `YYYY-MM-DD` in the Owner timezone (`OWNER_TIMEZONE`), or `null` for Anytime.
- `reminder`: `{ time, status, failure, sentAt }` or `null`. Always `null` for now; Reminders arrive in a later step.
- `references`: the Project references derived from the title, `{ key, projectId, projectDeleted }`, in the order the keys appear in the title and without duplicates. See [Project references](#project-references).
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

## Project references

Every `@KEY` in the title (2 to 8 letters and digits, starting with a letter, case-insensitive) that names an existing Project becomes a reference. They are derived when the To-do is created, and again on every title save (a later step).

- The title is stored exactly as typed, `@crm` included. The reference reports the key in uppercase: `"Work on @crm UI"` gives `{ key: "CRM", projectId, projectDeleted: false }`.
- The whole run after the `@` must be a valid key. `@ABCDEFGHI` (9 characters), `@1AB` and a lone `@` are plain text.
- An unknown key gives no reference and no error: `"Check @CMR export"` is `201` with `references: []`.
- A repeated key is one reference; different keys are listed in title order.
- Soft-deleted Projects match too. Their reference stays with `projectDeleted: true`, and is `false` again after Restore.
- Projects may share a key (the default `MAT`). A key shared by several Projects references each live one, ordered by id. Only when no live Project has the key does it fall back to the soft-deleted ones, so a deleted `BBVA` and a new `BBVA` don't both show.
- Purging a Project drops its references; the To-dos keep the `@KEY` text, which is then plain text.
- A Sub-to-do never inherits its parent's references; it has only what its own title names.
- `GET` resolves `references` for a whole page in one query.

## Errors

The standard body `{ error: { code, message, details } }`. A bad request is `400 validation_error` with `details.fields` naming each field: an empty or over-long `title`, a malformed `day`, a missing or unknown `state`, a bad `limit`, `includeDeleted` or `cursor`, or a body that is not JSON. An unknown id is `404 not_found`.
