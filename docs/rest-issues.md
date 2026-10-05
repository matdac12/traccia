# REST: issues, comments, search, activity, trash

All routes live under `/v1` and need a bearer token; every write is stamped with the token's actor.

## Issues

- `GET /v1/issues`: list filters from the service (`project`, `status` (repeatable), `assignee`, `label` (repeatable), `milestone`, `parent`, `priority`, `createdBy`, `updatedAfter`, `q`, `includeDeleted`, `orderBy`, `order`, `limit`, `cursor`). Returns `{ items, nextCursor }`.
- `GET /v1/issues/groups`: the same filters as the list, but one page **per status** in one call (the dashboard's table and board). `status` (repeatable) picks the groups, default all six, always in workflow order; `limit` is per group; `cursor=<status>:<cursor>` (repeatable, one per group) continues that group with the `nextCursor` it returned. Returns `{ groups: [{ status, items, nextCursor }], syncToken }`. Each group equals `GET /v1/issues?status=<status>` with the same filters. `syncToken` is the newest `updatedAt` of any issue (unfiltered, soft-deleted included; `1970-01-01T00:00:00.000Z` on an empty database), read before the lists so a change landing in between is never missed; it is what the dashboard's change probe starts from. A malformed `cursor` or unknown status is `400 validation_error`; a cursor for a status not in `status` is ignored. Groups are separate reads, not one snapshot (the token is read first, so nothing is missed).
- `POST /v1/issues`, `GET|PATCH|DELETE /v1/issues/:identifier` (identifier or ID).
- `GET /v1/issues/:identifier` returns the issue plus `labels` and **nothing else by default**. `?include=` (comma-separated or repeated) adds exactly the named keys among `comments`, `activity`, `attachments`, `children`, `relations`.
- `PATCH` accepts the service update fields plus `labels`, `blockedBy` and `blocks`. All three **replace** the whole set (empty array clears; omit the key to leave it). Blocker changes commit atomically with the rest of the update.
- Concurrency: send `If-Match: <updatedAt>` or `expectedUpdatedAt` in the body (body wins). A stale value is `409 conflict` with `details.currentUpdatedAt` and nothing changes. `If-Match: *` means no condition. `PATCH .../position` does not check `expectedUpdatedAt`.
- `DELETE` soft-deletes; `?purge=true` permanently removes an already deleted item (`you` only unless agent purge is on). `POST /v1/issues/:identifier/restore` restores the whole batch.
- `PATCH /v1/issues/:identifier/position` with `{ status, beforeId?, afterId? }`.

## Projects with milestones

`GET /v1/projects?include=milestones` adds `milestones` (with `progress`, like `GET /v1/projects/:id/milestones`) to every project, so a page needing both does not call once per project. Without `include` the response is unchanged.

## Comments

`GET|POST /v1/issues/:identifier/comments`, `PATCH|DELETE /v1/comments/:id`. Only the actor who wrote a comment may edit it (`403 forbidden` otherwise); delete has no ownership rule.

## Search

`GET /v1/search?q=&project=` returns one result per issue with a `snippet`. The snippet wraps hits in `<mark>…</mark>` but the surrounding text is raw issue/comment text and is **not HTML-escaped**. The dashboard must escape it, then re-enable the `<mark>` tags, before rendering it as HTML.

## Activity feed

`GET /v1/activity?project=&limit=&cursor=`: newest first, each row with `identifier`, `title`, `actor`, `type` and parsed `data`. `project` (id, name or key, resolved like the issue list's `project` filter) limits it to that project's issues; an unknown project is a 404. Activity of deleted issues is hidden until restore.

## Trash

`GET /v1/trash?type=&limit=&cursor=`: deleted items of every type, newest deletion first. Generic `POST /v1/restore` belongs to TRC-31.
