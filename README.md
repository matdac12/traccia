# Traccia

A minimal self-hosted issue tracker for one human and their AI agents, replacing a mostly unused Linear plan. Agents reach it over MCP; the human uses a dashboard. Everything stays on a private Tailscale network. The source of truth is [`tracker-spec.md`](tracker-spec.md); vocabulary is in [`GLOSSARY.md`](GLOSSARY.md) and design decisions are in [`docs/adr/`](docs/adr/).

The product is called Traccia; code, images and the CLI keep the identifier `tracker` ([ADR 0011](docs/adr/0011-product-name-traccia.md)).

## What v1 includes

- Issues, comments, projects, milestones and labels, with sub-issues, priority, estimates and blockers.
- Attachments (screenshots) on issues.
- Soft delete with restore; purge is restricted.
- Full-text search.
- Two actors only, `agent` and `you`; every write is attributed.
- An MCP server mirroring Linear's tool names, a REST API, and a dashboard (table grouped by status, plus Kanban).

**Not in v1**: teams, multiple users, permissions, cycles, documents, custom statuses or fields, notifications, integrations, time tracking, roadmaps, real-time collaboration, mobile app. See spec sections 1 and 17.

**Status**: the api (REST, MCP, attachments), the deploy tooling and the backup tooling are in place. The dashboard (`apps/web`) is still a placeholder; it is being built (MAT-1719).

## Architecture

```
 agents (Claude Code, Codex, ...)            you (browser)
   MCP /mcp, Bearer token                      https://<host>/
            \                                  /
             tailscale serve (HTTPS 443, MagicDNS name, path routing)
               /mcp, /v1/*, /files/*, /healthz  -> api  127.0.0.1:8787
               /                                -> web  127.0.0.1:3000
                                                     |  server-side calls, `you` token
 api (Hono, one Node process): REST + MCP + attachments --+
   one service layer, all business rules live here
   SQLite (WAL) DATA_DIR/tracker.db   DATA_DIR/attachments/
```

- **api** (`apps/api`): a Hono service. REST (`/v1/*`), MCP (`/mcp`) and attachment downloads (`/files/*`) are thin adapters over one service layer ([ADR 0006](docs/adr/0006-one-service-layer-stateless-mcp-on-hono.md)). It is the only process that touches the database.
- **web** (`apps/web`): the Next.js dashboard. It calls the REST API from server-side code only, with a `you` token held in its environment; the browser never calls the API or sees the token.
- **State**: one SQLite file plus one attachments folder under `DATA_DIR`, run by a single writer ([ADR 0001](docs/adr/0001-sqlite-single-file-single-writer.md)). Never run two api instances against the same data.
- **Actors**: every token maps to one actor, `agent` (shared by all AI agents) or `you` (the human, including the dashboard's token) ([ADR 0003](docs/adr/0003-two-actors-plain-column.md)).
- **Publishing**: nothing is public. `tailscale serve` is the only publisher, on 443 ([ADR 0007](docs/adr/0007-tailnet-only-publishing.md)).
- `packages/shared`: shared schemas, types and constants.

## Local dev

Requires Node 22 or newer (`nvm use` reads `.nvmrc`) and pnpm 10 (via corepack: `corepack enable`).

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test        # api: 30+ test files, runs against temp SQLite files, no services needed
pnpm format      # apply Biome formatting
```

Run the api. `BASE_URL` is required, and `DATA_DIR` defaults to `/data`, so point it at a writable folder:

```sh
export BASE_URL=http://localhost:8787 DATA_DIR=/tmp/traccia-data
mkdir -p "$DATA_DIR"
pnpm --filter api dev                   # http://localhost:8787/healthz -> {"ok":true}

# in another shell, with the same BASE_URL and DATA_DIR:
pnpm --filter api tracker token create --name local --actor you
curl -H "Authorization: Bearer <token>" http://localhost:8787/v1/me
```

The CLI (`pnpm --filter api tracker <command>`; in the container it is `node dist/tracker.js`) manages tokens, migrations and snapshots; every command takes `--help`. The database is created and migrated on startup.

The dashboard is a placeholder for now, so there is nothing to run for `apps/web` yet.

## Configuration

One `.env` file, read by both services in production (never committed). The template is [`deploy/.env.example`](deploy/.env.example). The api validates its variables with Zod at startup and exits with a clear message on a bad value; [`apps/api/src/config.ts`](apps/api/src/config.ts) is the only place that reads `process.env`. A test (`apps/api/test/readme.test.ts`) fails if this table misses a variable from `config.ts`.

| Variable | Service | Default | Purpose |
|----------|---------|---------|---------|
| `PORT` | api | `8787` | HTTP port. Fixed to `8787` in the compose file |
| `DATA_DIR` | api | `/data` | SQLite file and attachments. Fixed to `/data` (the `tracker-data` volume) in the compose file |
| `BASE_URL` | api | required | Externally visible URL, e.g. `https://omni.tail2b3fbf.ts.net`; used to build attachment links |
| `MAX_ATTACHMENT_BYTES` | api | `10485760` | Per-file cap (10 MiB) |
| `MAX_MCP_UPLOAD_BYTES` | api | `5242880` | Base64 upload cap over MCP (5 MiB) |
| `DEFAULT_ISSUE_KEY` | api | `MAT` | Issue key used when a project is created without one |
| `ALLOW_AGENT_PURGE` | api | `false` | Whether `agent` tokens may purge |
| `RATE_LIMIT_PER_MIN` | api | `120` | Requests per minute, per token |
| `LOG_LEVEL` | api | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |
| `TRUST_PROXY` | api | `true` | Read the client IP from `X-Forwarded-For` |
| `TRACKER_API_URL` | web | `http://api:8787` | API address for the dashboard's server-side calls; set by the compose file |
| `TRACKER_API_TOKEN` | web | empty | Token of a `you` actor, server-side only |
| `DASHBOARD_ALLOWED_LOGINS` | web | empty | Comma-separated Tailscale logins allowed to open the dashboard |

Booleans accept only `true` or `false`. An empty value counts as unset.

## Deploy

Docker Compose in `/opt/tracker` on the VPS (`omni`). Images are built on the Mac for `linux/amd64` and shipped with `docker save | ssh omni docker load`; there is no registry and no CI, and nothing is built on the VPS ([ADR 0009](docs/adr/0009-docker-compose-images-built-on-mac.md)).

```sh
deploy/deploy.sh --dry-run   # print the steps, touch nothing
deploy/deploy.sh             # build, ship, restart, wait for /healthz
```

One-time setup: create `/opt/tracker` on the VPS and put the `.env` there (`cp deploy/.env.example`, fill in `BASE_URL`, `TRACKER_API_TOKEN` and `DASHBOARD_ALLOWED_LOGINS`, `chmod 600`). Create tokens with the CLI inside the container (`docker compose exec api node dist/tracker.js token create ...`). Rollback is `TAG=<previous tag> docker compose up -d`; tags are listed in `/opt/tracker/deployed-tags`. Full details, rollback and token management: [`deploy/README.md`](deploy/README.md).

Both services bind to `127.0.0.1` only. Publish them to the tailnet with `tailscale serve` on `omni`:

```sh
sudo tailscale serve --bg --https=443 --set-path=/ http://127.0.0.1:3000
sudo tailscale serve --bg --https=443 --set-path=/mcp http://127.0.0.1:8787/mcp
sudo tailscale serve --bg --https=443 --set-path=/v1 http://127.0.0.1:8787/v1
sudo tailscale serve --bg --https=443 --set-path=/files http://127.0.0.1:8787/files
sudo tailscale serve --bg --https=443 --set-path=/healthz http://127.0.0.1:8787/healthz
tailscale serve status
```

> These commands have not been run against `omni`. The flags match the CLI help of Tailscale 1.102.4, but the path mapping (a path is stripped unless the target repeats it, hence the repeated paths) must be checked on the real node during the deploy phase, as spec 3.1 says. Do not run `tailscale funnel`.

## Backup and restore

A daily SQLite snapshot on the VPS (`tracker db snapshot`, last 3 kept), a manual pull of the newest snapshot plus attachments to the Windows machine, and a step-by-step restore procedure: see [`docs/backup-restore.md`](docs/backup-restore.md) and [ADR 0010](docs/adr/0010-backups-online-snapshot-manual-pull.md). The off-box copy can be stale; that is accepted for v1. The Windows pull script has not yet been run for real, and the restore test is still to be done.

## Security notes

- **Tailnet only.** Nothing listens on a public interface and Funnel stays off. Tailscale ACLs decide which devices reach `omni`; bearer tokens decide which actor is calling. Both stay on.
- **Tokens.** Create one per machine or agent. A token is bound to one actor, stored hashed (SHA-256), and shown once at creation. Revocation is immediate. There is no public token endpoint; tokens are managed with the CLI on the VPS.
- **Dashboard access** compares the `Tailscale-User-Login` header, added by `tailscale serve`, with `DASHBOARD_ALLOWED_LOGINS` ([ADR 0008](docs/adr/0008-dashboard-access-identity-header-only.md)). **Accepted risk:** another process on `omni` could forge that header by calling `127.0.0.1:3000` directly. Revisit if the host ever runs third-party code.
- **Agent purge** is disabled by default (`ALLOW_AGENT_PURGE=false`); deletes by agents are soft and restorable ([ADR 0004](docs/adr/0004-soft-delete-batches-restricted-purge.md)).
- Attachment uploads are validated by magic bytes and size, and `sourceUrl` fetches go through an SSRF blocklist.

## Known limitations in v1

- Runtimes outside the tailnet (CI, cloud agents, phone without Tailscale, claude.ai connectors) cannot reach it. An OAuth phase would expose only `/mcp` publicly.
- Full-text search uses Porter stemming, which is English-only; Italian text is matched with accent folding but no stemming.
- No live updates (SSE); the dashboard is planned to poll every 10-15 s and revalidate on focus (spec 12.2).
- The off-box backup can be stale, and the dashboard is not built yet.

## Layout

- `apps/api`: Hono service (REST, MCP, attachments) and the `tracker` CLI
- `apps/web`: dashboard (placeholder, in progress)
- `packages/shared`: shared schemas, types, constants
- `deploy/`: compose file, deploy script, backup units, Windows pull script
- `docs/`: backup and restore, REST notes, ADRs, agent docs
