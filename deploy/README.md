# Deploying to a VPS

Docker Compose in `/opt/tracker` on the VPS (`<your-server>`). Images are built on the Mac for `linux/amd64`, shipped with `docker save | ssh <your-server> docker load`, and started with `docker compose up -d`. No registry, no CI, and nothing is ever built on the VPS (spec 14.1, 4).

| File | Purpose |
|------|---------|
| `deploy.sh` | Run on the Mac: build, ship, restart, wait for health |
| `docker-compose.yml` | Copied to `/opt/tracker` by `deploy.sh` |
| `.env.example` | Template for `/opt/tracker/.env` |
| `backup/` | Daily snapshot timer for the VPS and the Windows pull script; see [`docs/backup-restore.md`](../docs/backup-restore.md) |

Both services publish to `127.0.0.1` only (`8787` api, `3000` web). `tailscale serve` is the only thing that exposes them to the tailnet (spec 3.1).

## One-time setup on the VPS

```sh
ssh <your-server>
sudo mkdir -p /opt/tracker && sudo chown "$USER" /opt/tracker
cp .env.example /opt/tracker/.env   # or paste it; then fill it in
chmod 600 /opt/tracker/.env
```

The `ssh <your-server>` alias sets `RemoteCommand` and `RequestTTY`, so scripts must use `ssh -o RemoteCommand=none -o RequestTTY=no <your-server>`. `deploy.sh` already does.

## Deploy

From the repo root on the Mac (Docker Desktop running):

```sh
deploy/deploy.sh --dry-run   # print the steps, touch nothing
deploy/deploy.sh
```

The script tags both images with the git short SHA (plus `-dirty-<timestamp>` if the tree has uncommitted changes) and `latest`, loads them on `<your-server>`, runs `TAG=<sha> docker compose up -d`, polls `http://127.0.0.1:8787/healthz` on the VPS, and removes images older than the last 3 deployed tags. Deployed tags are appended to `/opt/tracker/deployed-tags` (the last line is the current one).

Set `DEPLOY_HOST` to the ssh alias or hostname of your server (required: the script has no default and exits if it is unset, e.g. `DEPLOY_HOST=my-vps deploy/deploy.sh`). Optional: `DEPLOY_DIR` (default `/opt/tracker`).

## Rollback

The previous images stay on the VPS. Find the tag and start it:

```sh
ssh -o RemoteCommand=none -o RequestTTY=no <your-server> 'tail -n 3 /opt/tracker/deployed-tags'
ssh -o RemoteCommand=none -o RequestTTY=no <your-server> 'cd /opt/tracker && TAG=<previous tag> docker compose up -d'
```

Rollback does not touch `/data`. If the bad release ran a database migration, restore a snapshot instead ([`docs/backup-restore.md`](../docs/backup-restore.md)); migrations are forward-only.

A plain `docker compose up -d` without `TAG` starts the `latest` tag, which is the most recent deploy.

## Running locally on the Mac

```sh
docker buildx build --platform linux/amd64 --load -f apps/api/Dockerfile -t traccia-api:latest .
docker buildx build --platform linux/amd64 --load -f apps/web/Dockerfile -t traccia-web:latest .
cd deploy && cp .env.example .env   # set BASE_URL=http://localhost:8787
docker compose up
curl localhost:8787/healthz   # {"ok":true}
```

Run the CLI inside the api container: `docker compose exec api node dist/traccia.js db migrate`.

### Managing tokens

There is no public token endpoint; tokens are managed with the CLI inside the api container, against the same `DATA_DIR`:

```sh
docker compose exec api node dist/traccia.js token create --name "claude-code" --actor agent   # actor: agent | you
docker compose exec api node dist/traccia.js token list
docker compose exec api node dist/traccia.js token revoke <id>
```

`create` prints the plaintext token once, never again; copy it immediately. `list` shows id, name, actor, created, last used and revoked, never secrets. `revoke` takes effect immediately and is safe to repeat. Every command accepts `--help` and exits non-zero with a message on failure.

When running these over SSH, bypass any `RemoteCommand` in your SSH config and skip the TTY so the output is captured cleanly:

```sh
ssh -o RemoteCommand=none -o RequestTTY=no <your-server> 'cd <deploy dir> && docker compose exec -T api node dist/traccia.js token list'
```

## The `.env` file

One file, read by both services (never committed; `.env` is gitignored). See spec 13 for the full reference.

| Variable | Service | Default | Purpose |
|----------|---------|---------|---------|
| `BASE_URL` | api | required | Externally visible URL, e.g. `https://<your-tailnet-host>` |
| `MAX_ATTACHMENT_BYTES` | api | `10485760` | Per-file cap |
| `MAX_MCP_UPLOAD_BYTES` | api | `5242880` | Base64 upload cap |
| `DEFAULT_ISSUE_KEY` | api | `MAT` | Issue key prefix for new projects |
| `ALLOW_AGENT_PURGE` | api | `false` | Whether agent tokens may purge |
| `RATE_LIMIT_PER_MIN` | api | `120` | Per token |
| `RATE_LIMIT_YOU_PER_MIN` | api | `1200` | Per `you` token (dashboard) |
| `LOG_LEVEL` | api | `info` | |
| `TRUST_PROXY` | api | `true` | Read client IP from `X-Forwarded-For` |
| `TRACCIA_API_TOKEN` | web | empty | Token of a `you` actor, server-side only |
| `DASHBOARD_ALLOWED_LOGINS` | web | empty | Tailscale logins allowed to open the dashboard |

`PORT` and `DATA_DIR` are fixed in the compose file (`8787` and `/data`), and `TRACCIA_API_URL` is `http://api:8787` over the compose network. Data lives in the `traccia-data` named volume (`TRACCIA_DATA_VOLUME` overrides its name; see the rename notes below).

## Moving an install that predates the Traccia rename

The images, Compose project and data volume were called `tracker` before the rename ([ADR 0012](../docs/adr/0012-rename-to-traccia-with-legacy-aliases.md)). An existing install keeps its data and its `.env`. Run these in order (done once for the owner). Every command goes through `ssh -o RemoteCommand=none -o RequestTTY=no <your-server> '...'`.

1. **Record the before state.** `docker volume ls` (expect `tracker_tracker-data`), `docker ps`, the issue and project counts, and `tail /opt/tracker/deployed-tags`.
2. **Take a snapshot and check it.** `cd /opt/tracker && docker compose exec -T api node dist/tracker.js db snapshot` (the exception to the `traccia.js` naming: the old image only has `tracker.js`; it prints `integrity_check ok`).
3. **Keep the old compose file.** `deploy.sh` overwrites `/opt/tracker/docker-compose.yml`, so rollback needs a copy: `cp -p /opt/tracker/docker-compose.yml /opt/tracker/docker-compose.tracker.yml.bak`.
4. **Pin the volume.** First check that `.env` ends with a newline (`tail -c1 /opt/tracker/.env | xxd` shows `0a`), or the new line is glued to the last variable. Then `echo TRACCIA_DATA_VOLUME=tracker_tracker-data >> /opt/tracker/.env`. Without it Compose creates a new, empty `traccia-data` volume.
5. **Install the renamed snapshot units without enabling them.** `scp deploy/backup/traccia-snapshot.{service,timer} <your-server>:/tmp/`, then `install -m 644` them into `/etc/systemd/system/` and `systemctl daemon-reload`. The author's server logs in as root; otherwise use `sudo`.
6. **Stop the old project, then deploy.** `cd /opt/tracker && docker compose -p tracker down` (keeps volumes), then `deploy/deploy.sh` from the Mac. `deploy.sh` refuses to continue while the old project is running. Compose prints a warning that `tracker_tracker-data` "was created for project tracker"; it is expected and harmless.
7. **Verify.** `/healthz` through the tailnet URL, the dashboard (`/issues` returns 200), unauthenticated `/mcp` returns 401, the same issue and project counts, and `ss -ltn` shows only `127.0.0.1:8787` and `127.0.0.1:3000`. On the server, `docker compose exec -T api node dist/traccia.js token list` shows the dashboard token's `last used` updating after you load a dashboard page, so the web reached the api.
8. **Switch the snapshot timer.** `systemctl enable --now traccia-snapshot.timer`, `systemctl disable --now tracker-snapshot.timer`, `systemctl start traccia-snapshot.service` once, check the journal and `systemctl list-timers`. Do not leave both enabled. The old unit fails while no api is running (between the `down` and the deploy), so switch the same day.

Notes:

- `TRACKER_API_TOKEN` in `.env` still works through the legacy alias; rename it to `TRACCIA_API_TOKEN` when convenient.
- `dist/tracker.js` stays in the image for one release.
- `deploy.sh` prunes only `traccia-*` images. The old `tracker-*` images and the `tracker-snapshot` unit files stay until you remove them (`docker rmi`, `rm /etc/systemd/system/tracker-snapshot.*`).

### Rolling back the cutover

Before the old images and volume are removed:

```sh
cd /opt/tracker && docker compose -p traccia down       # the new project
cp docker-compose.tracker.yml.bak docker-compose.yml
TAG=<last tracker-* tag> docker compose -p tracker up -d   # tag from the line before the first traccia one in deployed-tags
systemctl disable --now traccia-snapshot.timer && systemctl enable --now tracker-snapshot.timer
```

`deploy.sh` prints `rollback: ... TAG=<previous tag>`; that only works for `traccia-*` tags, so after this one-time move use the commands above. The volume is shared by both projects and the data stays in place, so nothing moves; the old compose file ignores the extra `TRACCIA_DATA_VOLUME` line in `.env`.

### Agent machines

The `tracker` entry in Claude Code can sit in the local scope of the project folder rather than the user scope. Look in `~/.claude.json` (keys only, never print the header) or run `claude mcp list` from that folder, then `claude mcp remove tracker --scope <scope>` from the same folder. Re-add it as `traccia` with the same scope, following [`docs/agent-setup.md`](../docs/agent-setup.md). `TRACCIA_TOKEN` must be set in the environment that launches `claude`, otherwise the server fails with 401; restart the Claude Code session to pick up the new entry.
