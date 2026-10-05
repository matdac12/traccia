# Backup and restore

Decision: [ADR 0010](adr/0010-backups-online-snapshot-manual-pull.md) and spec 14.2. A daily online snapshot of the SQLite database on the VPS (`omni`), and a manual pull of the newest snapshot plus attachments to the Windows machine over the tailnet. Three copies are kept in each place. No Litestream, no cloud.

The off-box copy can be stale: anything written since the last pull is lost if `omni` dies. That is accepted for v1.

## What gets backed up

| Data | Where it lives | How it is backed up |
|------|----------------|---------------------|
| Database | `/data/traccia.db` (or the pre-rename `/data/tracker.db`) in the `traccia-data` volume (omni: `tracker_tracker-data`) | Daily snapshot to `/data/backups/traccia-<UTC timestamp>.db`, last 3 kept |
| Attachments | `/data/attachments` in the same volume | Copied by the Windows pull; no snapshot on the VPS |

## How the snapshot works

```sh
docker compose exec -T api node dist/traccia.js db snapshot [--out <dir>] [--keep <n>]
```

- Uses SQLite `VACUUM INTO` from the API's own runtime (the host has no `sqlite3` CLI). It reads one consistent view of the WAL database, so it is safe while the API is serving writes. The live file is never copied directly.
- Writes `traccia-<UTC timestamp>.db` (e.g. `traccia-20261005T033000Z.db`) to `${DATA_DIR}/backups`, or to `--out`. Files are `0600` (they contain token hashes).
- Writes under a temporary name, runs `PRAGMA integrity_check` on the copy, and only then renames it into place. A failed run leaves no snapshot.
- Then deletes older snapshots beyond `--keep` (default 3). Only files named `traccia-<timestamp>.db` (or the pre-rename `tracker-<timestamp>.db`, still pruned by age) are ever considered. Retention runs after a verified snapshot, so a failing job never eats your good copies.
- Exits non-zero with a message on any failure (unwritable `--out`, missing database, failed integrity check).

Run it by hand any time, for example before a risky migration:

```sh
ssh -o RemoteCommand=none -o RequestTTY=no omni 'cd /opt/tracker && docker compose exec -T api node dist/traccia.js db snapshot'
```

The `-o RemoteCommand=none -o RequestTTY=no` flags are needed because the `omni` alias in the ssh config sets `RemoteCommand` and `RequestTTY`, which break scripted output. The same applies to every `ssh omni` command below.

## Scheduling the daily snapshot (on omni)

Files in `deploy/backup/`: `traccia-snapshot.service` (one-shot, runs the command above from `/opt/tracker`) and `traccia-snapshot.timer` (03:30 daily, `Persistent=true` so a missed run catches up).

Installing it is a separate human step (P5); nothing in this repo does it. Install:

```sh
scp deploy/backup/traccia-snapshot.{service,timer} omni:/tmp/
ssh -o RemoteCommand=none -o RequestTTY=no omni 'sudo install -m 644 /tmp/traccia-snapshot.service /tmp/traccia-snapshot.timer /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now traccia-snapshot.timer'
```

If the old `tracker-snapshot.timer` is installed, disable it in the same step (`systemctl disable --now tracker-snapshot.timer`) and never leave both enabled; see the rename notes in [`deploy/README.md`](../deploy/README.md).

Check it:

```sh
ssh -o RemoteCommand=none -o RequestTTY=no omni 'systemctl list-timers traccia-snapshot.timer; sudo systemctl start traccia-snapshot.service; journalctl -u traccia-snapshot.service -n 20 --no-pager'
```

Cron alternative, if you prefer it: `30 3 * * * cd /opt/tracker && docker compose exec -T api node dist/traccia.js db snapshot >> /var/log/traccia-snapshot.log 2>&1`.

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

1. Lists `/data/backups` and picks the newest `traccia-*.db` (or pre-rename `tracker-*.db`).
2. Streams that snapshot plus `/data/attachments` into a temporary tar, checks it with `tar -t`, and extracts it into `omni-<timestamp>\` (`backups\traccia-….db` and `attachments\`). If omni has no `/data/attachments` yet (nothing was ever uploaded), the pull has no `attachments\` folder and the script prints `attachments: none (no attachments on omni)`; that is not an error.
3. Only after a successful pull, deletes older `omni-*` folders beyond `-Keep` (default 3).

It never writes to or deletes anything on the VPS. Retention touches only folders matching `omni-<digits>-<digits>` in the destination. Pull after the daily timer has run at least once, otherwise it stops with "No snapshot found".

## Restore procedure

Do this into a scratch location, not over production. The first time is the restore test (once, before the pilot ends). For a real disaster, the same steps apply but the final data goes into the `traccia-data` volume on the new host.

Use the newest folder from the Windows pull: `omni-<timestamp>\backups\traccia-<UTC>.db` (or the pre-rename `tracker-<UTC>.db`) and `omni-<timestamp>\attachments\`.

The restore machine needs Docker and the `traccia-api:latest` image. If it doesn't have the image, either build it there from the repo root (`docker buildx build --platform linux/amd64 --load -f apps/api/Dockerfile -t traccia-api:latest .`), or save it on the machine that has it and move the tar over (tailnet/Taildrop or a share), then load it:

```sh
docker save traccia-api:latest -o traccia-api.tar   # on the machine that has the image
```

```powershell
docker load -i traccia-api.tar                       # on the restore machine
```

The image is `linux/amd64`; on an Apple Silicon Mac Docker runs it under emulation and prints a platform warning, which is harmless (add `--platform linux/amd64` to silence it).

The snapshot lives inside the `traccia-data` volume, not at a host path, so `scp omni:/data/backups/...` does not work. To fetch one by hand without the Windows script, stream it out of the container (read-only):

```sh
ssh -o RemoteCommand=none -o RequestTTY=no omni 'cd /opt/tracker && docker compose exec -T api cat /data/backups/traccia-<UTC>.db' > traccia.db
```

1. **Lay out a scratch data dir.** The API expects `traccia.db` and `attachments/` side by side:

   ```powershell
   $pull = "$HOME\traccia-backups\omni-<timestamp>"
   $scratch = "$HOME\traccia-restore-test"
   New-Item -ItemType Directory -Force "$scratch" | Out-Null
   Copy-Item "$pull\backups\traccia-<UTC>.db" "$scratch\traccia.db"
   Copy-Item "$pull\attachments" "$scratch\attachments" -Recurse   # skip if the pull has none
   ```

   Do not copy any `traccia.db-wal` or `-shm` files; a snapshot is a single self-contained file.

2. **Check the database.** Using the image, since there is no `sqlite3` CLI:

   ```powershell
   docker run --rm -v "${scratch}:/data" traccia-api:latest node -e "const D=require('better-sqlite3');const d=new D('/data/traccia.db',{readonly:true});console.log(d.pragma('integrity_check'),d.prepare('select count(*) n from issues').get())"
   ```

   Expect `[ { integrity_check: 'ok' } ]` and an issue count that matches what you expect.

3. **Start the service on it** on a spare port, with a throwaway `BASE_URL`:

   ```powershell
   docker run --rm -d --name traccia-restore -p 127.0.0.1:18787:8787 `
     -v "${scratch}:/data" -e DATA_DIR=/data -e PORT=8787 -e BASE_URL=http://localhost:18787 `
     traccia-api:latest
   curl.exe http://localhost:18787/healthz     # {"ok":true}
   ```

   Startup applies any pending migrations to the scratch copy only. The container runs as uid 1000 (`node`) and must be able to write to the scratch folder; on a Linux host, `chown -R 1000:1000` it if startup fails with a permission error. Note `docker run` here is not `docker compose`: the volume is the scratch folder, never the production data volume (`traccia-data`, or `tracker_tracker-data` on an install that predates the rename).

4. **Check issues and attachments load.** Mint a token against the scratch data, then read through the API:

   ```powershell
   docker exec traccia-restore node dist/traccia.js token create --name restore-test --actor you
   docker exec traccia-restore node dist/traccia.js token list
   ```

   `token create` prints the plaintext token on its own line, once. Using it, list issues over REST (`curl -H "Authorization: Bearer <token>" http://localhost:18787/v1/issues`) or MCP (`list_issues`) and confirm recent issues are present. Check search too: `curl -H "Authorization: Bearer <token>" "http://localhost:18787/v1/search?q=<word from a known title>"` should return a hit with a `<mark>` snippet. The FTS index is part of the snapshot, so no reindex is needed. Open an issue that has an attachment and download it (`GET /v1/attachments/<id>`); confirm it opens and its size matches. If the live tracker has no attachments yet there is no `attachments/` directory in the volume and the pull produces none; that is expected, and attachment restore is then untested. Spot-check the newest issue you know of to see how stale the copy is.

5. **Clean up.**

   ```powershell
   docker stop traccia-restore
   Remove-Item "$scratch" -Recurse -Force
   ```

6. **Record the result** (date, snapshot used, what you checked, how stale) on the restore-test issue.

### Restoring for real on omni

Stop the stack so nothing writes (`docker compose stop`), copy the snapshot into the volume as `traccia.db` (removing any old `traccia.db-wal`/`-shm`) and `attachments/` alongside it, make them owned by the container's `node` user, then `docker compose up -d`. Keep the damaged files until the restored system is confirmed good.
