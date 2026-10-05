# One shared issue key (`MAT`) with the counter on `issue_keys`

Identifiers come from a counter stored on a key row, not on the project, and every project uses the key `MAT`, as in the Linear team. This keeps old `MAT-n` identifiers valid when importing from Linear. As a consequence a project cannot be addressed by key, only by id or exact name. Numbers are allocated in the write transaction and never reused, and moving an issue to another project keeps its identifier.
