# Backups: daily SQLite online snapshot, manual pull to the Windows machine

A daily job on the VPS writes a consistent snapshot using SQLite online backup (or `VACUUM INTO`) from the tracker's own runtime, since the host has no `sqlite3` CLI. It keeps the last 3. The Windows machine pulls the latest snapshot plus attachments over the tailnet by hand, keeping 3 copies. We rejected Litestream and a cloud account, and accept that the off-box copy can be stale. A plain file copy of the live DB is never used. The restore procedure is tested once before the pilot ends.
