# Code identifiers are renamed to `traccia`; the old names keep working for one release

[ADR 0011](0011-product-name-traccia.md) chose the name Traccia and deferred renaming code identifiers. That rename is done (MAT-1739), before the pilot's agent configs roll out: the `traccia` CLI, the `traccia` MCP server name, the `@traccia/*` workspace packages, `TRACCIA_API_URL` and `TRACCIA_API_TOKEN`, the `traccia-api` and `traccia-web` images, the `traccia` Compose project and the `traccia-snapshot` systemd units.

The live deployment on `<your-server>` was built under the old names, so each renamed runtime identifier keeps a legacy alias for one release; remove the aliases after <your-server> has been redeployed and the agent configs updated:

- `dist/tracker.js` is built next to `dist/traccia.js`, and `pnpm --filter api tracker` still works, so the installed systemd unit and any cron line keep running.
- The web reads `TRACKER_API_URL` and `TRACKER_API_TOKEN` when the `TRACCIA_*` name is unset, in both the app and the compose file.
- `DATA_DIR` keeps using `tracker.db` when it exists and `traccia.db` does not. New databases are `traccia.db`.
- Snapshot retention and the Windows pull script accept `tracker-<UTC>.db` as well as `traccia-<UTC>.db`, ordered by timestamp.
- The compose data volume is named by `TRACCIA_DATA_VOLUME` (default `traccia-data`). <your-server> sets it to its existing volume `tracker_tracker-data`, so the rename never creates an empty database.

Not renamed: the `/opt/tracker` directory on `<your-server>`, the GitHub repository and the local folder. Those move separately, on the user's go (the runbook is in the PR for MAT-1739). The Compose project name changes, so `deploy.sh` refuses to start `traccia` while a `tracker` project is still running, because both bind the same ports.
