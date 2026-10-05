# Backup and restore

Decision: [ADR 0010](adr/0010-backups-online-snapshot-manual-pull.md) and spec 14.2. A daily online snapshot of the SQLite database on the VPS (`omni`), and a manual pull of the newest snapshot plus attachments to the Windows machine over the tailnet. Three copies are kept in each place. No Litestream, no cloud.

The off-box copy can be stale: anything written since the last pull is lost if `omni` dies. That is accepted for v1.

## What gets backed up

| Data | Where it lives | How it is backed up |
|------|----------------|---------------------|
| Database | `/data/tracker.db` in the `tracker-data` volume | Daily snapshot to `/data/backups/tracker-<UTC timestamp>.db`, last 3 kept |
| Attachments | `/data/attachments` in the same volume | Copied by the Windows pull; no snapshot on the VPS |

## How the snapshot works

```sh
docker compose exec -T api node dist/tracker.js db snapshot [--out <dir>] [--keep <n>]
```

- Uses SQLite `VACUUM INTO` from the API's own runtime (the host has no `sqlite3` CLI). It reads one consistent view of the WAL database, so it is safe while the API is serving writes. The live file is never copied directly.
- Writes `tracker-<UTC timestamp>.db` (e.g. `tracker-20261005T033000Z.db`) to `${DATA_DIR}/backups`, or to `--out`. Files are `0600` (they contain token hashes).
- Writes under a temporary name, runs `PRAGMA integrity_check` on the copy, and only then renames it into place. A failed run leaves no snapshot.
- Then deletes older snapshots beyond `--keep` (default 3). Only files named `tracker-<timestamp>.db` are ever considered. Retention runs after a verified snapshot, so a failing job never eats your good copies.
- Exits non-zero with a message on any failure (unwritable `--out`, missing database, failed integrity check).

Run it by hand any time, for example before a risky migration:

```sh
ssh -o RemoteCommand=none -o RequestTTY=no omni 'cd /opt/tracker && docker compose exec -T api node dist/tracker.js db snapshot'
```

The `-o RemoteCommand=none -o RequestTTY=no` flags are needed because the `omni` alias in the ssh config sets `RemoteCommand` and `RequestTTY`, which break scripted output. The same applies to every `ssh omni` command below.

## Scheduling the daily snapshot (on omni)

Files in `deploy/backup/`: `tracker-snapshot.service` (one-shot, runs the command above from `/opt/tracker`) and `tracker-snapshot.timer` (03:30 daily, `Persistent=true` so a missed run catches up).

Installing it is a separate human step (P5); nothing in this repo does it. Install:

```sh
scp deploy/backup/tracker-snapshot.{service,timer} omni:/tmp/
ssh -o RemoteCommand=none -o RequestTTY=no omni 'sudo install -m 644 /tmp/tracker-snapshot.service /tmp/tracker-snapshot.timer /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now tracker-snapshot.timer'
```

Check it:

```sh
ssh -o RemoteCommand=none -o RequestTTY=no omni 'systemctl list-timers tracker-snapshot.timer; sudo systemctl start tracker-snapshot.service; journalctl -u tracker-snapshot.service -n 20 --no-pager'
```

Cron alternative, if you prefer it: `30 3 * * * cd /opt/tracker && docker compose exec -T api node dist/tracker.js db snapshot >> /var/log/tracker-snapshot.log 2>&1`.

## Pulling to the Windows machine

Script: `deploy/backup/pull-from-omni.ps1` (PowerShell, Windows 10 1803+ or 11).

> **Run with `-WhatIf` first.** The first real run on Windows (MAT-1716) failed because Git for Windows' GNU `tar` comes first on `PATH` and reads `C:\...` as `host:path`; the script now calls `%SystemRoot%\System32\tar.exe` explicitly.

```powershell
.\pull-from-omni.ps1 -WhatIf   # print the steps, touch nothing
.\pull-from-omni.ps1           # pull into $HOME\traccia-backups\omni-<yyyyMMdd-HHmmss>
.\pull-from-omni.ps1 -Destination D:\backups -Keep 3
```

Tooling choice: the Windows OpenSSH client (`ssh.exe`) plus the built-in `tar.exe`. There is no `rsync` on Windows by default, and the data sits in a Docker volume that only root can read on the host, so the script asks the container to stream a tar over ssh (`docker compose exec -T api tar ... -cf -`) and extracts it locally. The stream goes through `Start-Process -RedirectStandardOutput`, because the PowerShell pipeline is not binary-safe.

It:

1. Lists `/data/backups/tracker-*.db` and picks the newest.
2. Streams that snapshot plus `/data/attachments` into a temporary tar, checks it with `tar -t`, and extracts it into `omni-<timestamp>\` (`backups\tracker-….db` and `attachments\`).
3. Only after a successful pull, deletes older `omni-*` folders beyond `-Keep` (default 3).

It never writes to or deletes anything on the VPS. Retention touches only folders matching `omni-<digits>-<digits>` in the destination. Pull after the daily timer has run at least once, otherwise it stops with "No snapshot found".

## Restore procedure

Do this into a scratch location, not over production. The first time is the restore test (once, before the pilot ends). For a real disaster, the same steps apply but the final data goes into the `tracker-data` volume on the new host.

Use the newest folder from the Windows pull: `omni-<timestamp>\backups\tracker-<UTC>.db` and `omni-<timestamp>\attachments\`. You need Docker, and an API image: `tracker-api:latest` built per `deploy/README.md` (or `docker load` a saved one).

1. **Lay out a scratch data dir.** The API expects `tracker.db` and `attachments/` side by side:

   ```powershell
   $pull = "$HOME\traccia-backups\omni-<timestamp>"
   $scratch = "$HOME\traccia-restore-test"
   New-Item -ItemType Directory -Force "$scratch" | Out-Null
   Copy-Item "$pull\backups\tracker-<UTC>.db" "$scratch\tracker.db"
   Copy-Item "$pull\attachments" "$scratch\attachments" -Recurse   # skip if the pull has none
   ```

   Do not copy any `tracker.db-wal` or `-shm` files; a snapshot is a single self-contained file.

2. **Check the database.** Using the image, since there is no `sqlite3` CLI:

   ```powershell
   docker run --rm -v "${scratch}:/data" tracker-api:latest node -e "const D=require('better-sqlite3');const d=new D('/data/tracker.db',{readonly:true});console.log(d.pragma('integrity_check'),d.prepare('select count(*) n from issues').get())"
   ```

   Expect `[ { integrity_check: 'ok' } ]` and an issue count that matches what you expect.

3. **Start the service on it** on a spare port, with a throwaway `BASE_URL`:

   ```powershell
   docker run --rm -d --name traccia-restore -p 127.0.0.1:18787:8787 `
     -v "${scratch}:/data" -e DATA_DIR=/data -e PORT=8787 -e BASE_URL=http://localhost:18787 `
     tracker-api:latest
   curl.exe http://localhost:18787/healthz     # {"ok":true}
   ```

   Startup applies any pending migrations to the scratch copy only. Note `docker run` here is not `docker compose`: the volume is the scratch folder, never `tracker-data`.

4. **Check issues and attachments load.** Mint a token against the scratch data, then read through the API:

   ```powershell
   docker exec traccia-restore node dist/tracker.js token create --name restore-test --actor you
   docker exec traccia-restore node dist/tracker.js token list
   ```

   Using that token, list issues over REST or MCP (`list_issues`) and confirm recent issues are present. Open an issue that has an attachment and download it; confirm it opens and its size matches. Spot-check the newest issue you know of to see how stale the copy is.

5. **Clean up.**

   ```powershell
   docker stop traccia-restore
   Remove-Item "$scratch" -Recurse -Force
   ```

6. **Record the result** (date, snapshot used, what you checked, how stale) on the restore-test issue.

### Restoring for real on omni

Stop the stack so nothing writes (`docker compose stop`), copy the snapshot into the volume as `tracker.db` (removing any old `tracker.db-wal`/`-shm`) and `attachments/` alongside it, make them owned by the container's `node` user, then `docker compose up -d`. Keep the damaged files until the restored system is confirmed good.
