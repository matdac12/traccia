# REST: issues, comments, search, activity, trash

All routes live under `/v1` and need a bearer token; every write is stamped with the token's actor.

## Issues

- `GET /v1/issues`: list filters from the service (`project`, `status` (repeatable), `assignee`, `label` (repeatable), `milestone`, `parent`, `priority`, `createdBy`, `updatedAfter`, `q`, `includeDeleted`, `orderBy`, `order`, `limit`, `cursor`). Returns `{ items, nextCursor }`.
- `POST /v1/issues`, `GET|PATCH|DELETE /v1/issues/:identifier` (identifier or ID).
- `GET /v1/issues/:identifier` returns the issue plus `labels` and **nothing else by default**. `?include=` (comma-separated or repeated) adds exactly the named keys among `comments`, `activity`, `attachments`, `children`, `relations`.
- `PATCH` accepts the service update fields plus `labels`, `blockedBy` and `blocks`. All three **replace** the whole set (empty array clears; omit the key to leave it). Blocker changes commit atomically with the rest of the update.
- Concurrency: send `If-Match: <updatedAt>` or `expectedUpdatedAt` in the body (body wins). A stale value is `409 conflict` with `details.currentUpdatedAt` and nothing changes. `If-Match: *` means no condition. `PATCH .../position` does not check `expectedUpdatedAt`.
- `DELETE` soft-deletes; `?purge=true` permanently removes an already deleted item (`you` only unless agent purge is on). `POST /v1/issues/:identifier/restore` restores the whole batch.
- `PATCH /v1/issues/:identifier/position` with `{ status, beforeId?, afterId? }`.

## Comments

`GET|POST /v1/issues/:identifier/comments`, `PATCH|DELETE /v1/comments/:id`. Only the actor who wrote a comment may edit it (`403 forbidden` otherwise); delete has no ownership rule.

## Search

`GET /v1/search?q=&project=` returns one result per issue with a `snippet`. The snippet wraps hits in `<mark>…</mark>` but the surrounding text is raw issue/comment text and is **not HTML-escaped**. The dashboard must escape it, then re-enable the `<mark>` tags, before rendering it as HTML.

## Activity feed

`GET /v1/activity?limit=&cursor=`: newest first, each row with `identifier`, `title`, `actor`, `type` and parsed `data`. Activity of deleted issues is hidden until restore.

## Trash

`GET /v1/trash?type=&limit=&cursor=`: deleted items of every type, newest deletion first. Generic `POST /v1/restore` belongs to MAT-1705.
