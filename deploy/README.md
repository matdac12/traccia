# Deploying to omni

Docker Compose in `/opt/tracker` on the VPS (`omni`). Images are built on the Mac for `linux/amd64`, shipped with `docker save | ssh omni docker load`, and started with `docker compose up -d`. No registry, no CI, and nothing is ever built on the VPS (spec 14.1, 4).

| File | Purpose |
|------|---------|
| `deploy.sh` | Run on the Mac: build, ship, restart, wait for health |
| `docker-compose.yml` | Copied to `/opt/tracker` by `deploy.sh` |
| `.env.example` | Template for `/opt/tracker/.env` |

Both services publish to `127.0.0.1` only (`8787` api, `3000` web). `tailscale serve` is the only thing that exposes them to the tailnet (spec 3.1).

## One-time setup on the VPS

```sh
ssh omni
sudo mkdir -p /opt/tracker && sudo chown "$USER" /opt/tracker
cp .env.example /opt/tracker/.env   # or paste it; then fill it in
chmod 600 /opt/tracker/.env
```

The `ssh omni` alias sets `RemoteCommand` and `RequestTTY`, so scripts must use `ssh -o RemoteCommand=none -o RequestTTY=no omni`. `deploy.sh` already does.

## Deploy

From the repo root on the Mac (Docker Desktop running):

```sh
deploy/deploy.sh --dry-run   # print the steps, touch nothing
deploy/deploy.sh
```

The script tags both images with the git short SHA (plus `-dirty-<timestamp>` if the tree has uncommitted changes) and `latest`, loads them on `omni`, runs `TAG=<sha> docker compose up -d`, polls `http://127.0.0.1:8787/healthz` on the VPS, and removes images older than the last 3 deployed tags. Deployed tags are appended to `/opt/tracker/deployed-tags` (the last line is the current one).

Overrides: `DEPLOY_HOST` (default `omni`), `DEPLOY_DIR` (default `/opt/tracker`).

## Rollback

The previous images stay on the VPS. Find the tag and start it:

```sh
ssh -o RemoteCommand=none -o RequestTTY=no omni 'tail -n 3 /opt/tracker/deployed-tags'
ssh -o RemoteCommand=none -o RequestTTY=no omni 'cd /opt/tracker && TAG=<previous tag> docker compose up -d'
```

Rollback does not touch `/data`. If the bad release ran a database migration, restore a snapshot instead (spec 14.2); migrations are forward-only.

A plain `docker compose up -d` without `TAG` starts the `latest` tag, which is the most recent deploy.

## Running locally on the Mac

```sh
docker buildx build --platform linux/amd64 --load -f apps/api/Dockerfile -t tracker-api:latest .
docker buildx build --platform linux/amd64 --load -f apps/web/Dockerfile -t tracker-web:latest .
cd deploy && cp .env.example .env   # set BASE_URL=http://localhost:8787
docker compose up
curl localhost:8787/healthz   # {"ok":true}
```

Run the CLI inside the api container: `docker compose exec api node dist/tracker.js db migrate`.

## The `.env` file

One file, read by both services (never committed; `.env` is gitignored). See spec 13 for the full reference.

| Variable | Service | Default | Purpose |
|----------|---------|---------|---------|
| `BASE_URL` | api | required | Externally visible URL, e.g. `https://omni.tail2b3fbf.ts.net` |
| `MAX_ATTACHMENT_BYTES` | api | `10485760` | Per-file cap |
| `MAX_MCP_UPLOAD_BYTES` | api | `5242880` | Base64 upload cap |
| `DEFAULT_ISSUE_KEY` | api | `MAT` | Issue key prefix for new projects |
| `ALLOW_AGENT_PURGE` | api | `false` | Whether agent tokens may purge |
| `RATE_LIMIT_PER_MIN` | api | `120` | Per token |
| `LOG_LEVEL` | api | `info` | |
| `TRUST_PROXY` | api | `true` | Read client IP from `X-Forwarded-For` |
| `TRACKER_API_TOKEN` | web | empty | Token of a `you` actor, server-side only |
| `DASHBOARD_ALLOWED_LOGINS` | web | empty | Tailscale logins allowed to open the dashboard |

`PORT` and `DATA_DIR` are fixed in the compose file (`8787` and `/data`), and `TRACKER_API_URL` is `http://api:8787` over the compose network. Data lives in the `tracker-data` named volume.
