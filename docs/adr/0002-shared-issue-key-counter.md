# One shared issue key (`MAT`) with the counter on `issue_keys`

Identifiers come from a counter stored on a key row, not on the project, and every project uses the key `MAT`, as in the Linear team. This keeps old `MAT-n` identifiers valid when importing from Linear. As a consequence a project cannot be addressed by key, only by id or exact name. Numbers are allocated in the write transaction and never reused, and moving an issue to another project keeps its identifier.

**Update (cutover to Traccia):** projects can now choose their own key at creation (`save_project` `key`, default `MAT`) and are addressable by key; the counter still lives on `issue_keys`. The Traccia project itself uses `TRC`, because `MAT` would clash with the archived Linear identifiers (`MAT-nnn`), which are not preserved: the one-time import numbered the issues `TRC-1`..`TRC-91` and recorded each original identifier at the top of the description.
