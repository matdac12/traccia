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

- `POST /v1/todos` with `{ title, day?, parentId?, details? }` returns `201` and the To-do. `title` is trimmed and must be 1 to 500 characters; `day` is `YYYY-MM-DD` (a real date) or `null`. The new To-do is open and goes to the bottom of its bucket. See [Sub-to-dos](#sub-to-dos) for `parentId`.
- `GET /v1/todos?state=open`: every open To-do as one flat list, Sub-to-dos included, ordered by `day` (Anytime last), then `position`, then `id`.
- `GET /v1/todos?state=closed`: the Logbook, done and dropped To-dos, most recently closed first.
- Both lists take `limit` (default 50, at most 250), `cursor` (the previous page's `nextCursor`) and `includeDeleted=true`, and return `{ items, nextCursor }`. `state` is required. A cursor only continues the list it came from.
- `GET /v1/todos/:id` returns one To-do, a deleted one included.
- `PATCH /v1/todos/:id` edits one To-do and returns it. See [Editing](#editing).

## Sub-to-dos

A Sub-to-do is a full To-do (own day, `details` and references) that hangs under a parent through `parentId`. They go one level deep: a Sub-to-do cannot have children.

- `parentId` on `POST` must name a To-do that exists, is top-level, is open and is not deleted. Otherwise it is `400 validation_error` with `details.fields.parentId`. The parent is only checked when the Sub-to-do is created; closing or deleting it later doesn't change the Sub-to-do on its own.
- A Sub-to-do's bucket is its Planned day (or Anytime) under its parent, so its `position` is independent of the top-level To-dos.
- `GET /v1/todos?state=open` lists Sub-to-dos in the same flat list; `state=closed` (the Logbook) includes closed Sub-to-dos.

## Editing

`PATCH /v1/todos/:id` with any of `{ title?, day?, details?, state?, closeSubTodos?, expectedUpdatedAt? }`. A deleted To-do is `404 not_found`.

- `title` is trimmed and checked like on create. A change re-derives its [references](#project-references) in the same write; an unchanged title leaves them alone.
- `day` is `YYYY-MM-DD` or `null` (Anytime). A different `day` moves the To-do to the bottom of that bucket; sending the same day changes nothing. `details` is markdown; an empty string clears it.
- `state` is `open`, `done` or `dropped`. Closing sets `closedAt`; a different closing state (done to dropped) sets it again; reopening clears it and leaves the Sub-to-dos as they are.
- A body with none of `title`, `day`, `details` and `state` (including `{}` and `{ "closeSubTodos": true }`) is `400 validation_error` "No fields to update". Fields that already hold the sent values are accepted and change nothing, `updatedAt` included.
- **Concurrency**: send `expectedUpdatedAt` in the body, or the `If-Match: "<updatedAt>"` header (the body wins). If the To-do changed since, it is `409 conflict` with `details.currentUpdatedAt`, and nothing is written.

### Closing a parent

A parent never closes on its own. Closing a To-do that has open Sub-to-dos (deleted ones don't count) without `closeSubTodos: true` is `409 conflict` with `details.openSubTodos: <n>`, and nothing is written. With `closeSubTodos: true` the open Sub-to-dos close the same way (done to done, dropped to dropped) with the same `closedAt`, in the same transaction. Sub-to-dos that are already done or dropped are left alone. The flag does nothing for a To-do without open Sub-to-dos. The `expectedUpdatedAt` check runs first.

## Project references

Every `@KEY` in the title (2 to 8 letters and digits, starting with a letter, case-insensitive) that names an existing Project becomes a reference. They are derived when the To-do is created, and again on every title save.

- The title is stored exactly as typed, `@crm` included. The reference reports the key in uppercase: `"Work on @crm UI"` gives `{ key: "CRM", projectId, projectDeleted: false }`.
- The `@` must start the title or follow a character that is not a letter or digit: `bob@crm.com` is an email address, so it gives no reference, while `(@crm)` and `x,@crm` do.
- The whole run after the `@` must be a valid key. `@ABCDEFGHI` (9 characters), `@1AB` and a lone `@` are plain text.
- An unknown key gives no reference and no error: `"Check @CMR export"` is `201` with `references: []`.
- A repeated key is one reference; different keys are listed in title order.
- Soft-deleted Projects match too. Their reference stays with `projectDeleted: true`, and is `false` again after Restore.
- Projects may share a key (the default `MAT`). A key shared by several Projects references each live one, ordered by id. Only when no live Project has the key does it fall back to the soft-deleted ones, so a deleted `BBVA` and a new `BBVA` don't both show.
- Purging a Project drops its references; the To-dos keep the `@KEY` text, which is then plain text.
- A Sub-to-do never inherits its parent's references; it has only what its own title names.
- `GET` resolves `references` for a whole page in one query.

## Errors

The standard body `{ error: { code, message, details } }`. A bad request is `400 validation_error` with `details.fields` naming each field: an empty or over-long `title`, a malformed `day`, a missing or unknown `state`, a bad `parentId`, an empty patch, a bad `limit`, `includeDeleted` or `cursor`, or a body that is not JSON. An unknown id is `404 not_found`. A stale `expectedUpdatedAt` or closing a parent with open Sub-to-dos is `409 conflict`, with `details.currentUpdatedAt` or `details.openSubTodos`.
