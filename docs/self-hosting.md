# Self-hosting Traccia

You are one small server and one tailnet away from your own tracker. This page is written so that an agent can follow it end to end. The quick version lives in the [README](../README.md#set-it-up-with-your-agent).

## What you end up with

- The `api` and the `web` dashboard, both bound to `127.0.0.1` only, on a server you own.
- `tailscale serve` publishes them to your tailnet on HTTPS 443. Nothing is public, and Funnel stays off.
- You open the dashboard at `https://<host>/` from any device on the tailnet.
- Your agents reach the MCP server at `https://<host>/mcp`, authenticated with a bearer token.

## What you need

| Thing | Notes |
| --- | --- |
| A Linux server | amd64, 1 vCPU and 2 GB RAM is enough. Steady memory is about 0.3 to 0.6 GB. Add a small swapfile if the box is tight. |
| Docker Engine and Compose v2 | `docker` and `docker compose` on the server. |
| A Tailscale account | The free plan is fine. MagicDNS on, HTTPS certificates enabled. |
| An MCP-capable agent | Claude Code, Codex or OpenCode, on a device that is also on the tailnet. |
| This repo | `git clone https://github.com/matdac12/traccia.git` |

No domain, no DNS work, no hosted account. Tailscale gives the machine a MagicDNS name (`<machine>.<tailnet>.ts.net`), and that name is your URL.

`<host>` below always means that full MagicDNS name. Read it from the machine with `tailscale status`; never invent it.

## 1. Put the server on your tailnet

Install Tailscale on the server, then bring it up. Approve the machine in the Tailscale admin console if your tailnet asks.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale status          # note this machine's MagicDNS name: <host>
```

Tailscale issues the HTTPS certificate for `tailscale serve`. If the first `serve` command complains, turn on HTTPS Certificates and MagicDNS in the admin console (DNS page), then retry.

## 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # then log out and back in
docker compose version
```

## 3. Get the code

```bash
git clone https://github.com/matdac12/traccia.git
cd traccia
```

## 4. Build the images

Build context is the repo root. Build both images on the server; never run `next build` or `next dev` on a small host outside the image.

```bash
docker buildx build --platform linux/amd64 --load -f apps/api/Dockerfile -t traccia-api:latest .
docker buildx build --platform linux/amd64 --load -f apps/web/Dockerfile -t traccia-web:latest .
```

On an amd64 server the `--platform` flag is optional. On Apple Silicon or another non-amd64 host it is required, because the images must be `linux/amd64`.

If your server is very small (under 2 GB RAM), build on a bigger machine and ship the images with `docker save | ssh <server> docker load` instead. That is the flow in [`deploy/README.md`](../deploy/README.md).

## 5. Configure `/opt/tracker`

```bash
sudo mkdir -p /opt/tracker && sudo chown "$USER" /opt/tracker
cp deploy/docker-compose.yml /opt/tracker/
cp deploy/.env.example /opt/tracker/.env
chmod 600 /opt/tracker/.env
```

Edit `/opt/tracker/.env` and set two values:

```ini
BASE_URL=https://<host>
DASHBOARD_ALLOWED_LOGINS=<your-tailscale-login>
```

- `BASE_URL` is the MagicDNS name with `https://`. The API refuses to start without it.
- `DASHBOARD_ALLOWED_LOGINS` is the Tailscale login (an email) allowed to open the dashboard. Use the account that owns the tailnet, or any login you want to let in. Find yours with `tailscale status`.
- Leave `TRACCIA_API_TOKEN` empty for now. You mint it in the next step.

## 6. Start the API and mint the dashboard token

The database is created and migrated on first start, so start the API alone first.

```bash
cd /opt/tracker
docker compose up -d api
docker compose exec -T api node dist/traccia.js token create --name dashboard --actor you
```

`token create` prints the plaintext token once. Copy it into `.env`:

```ini
TRACCIA_API_TOKEN=<paste the token>
```

The dashboard runs as the `you` actor, so its token is the only `you` token you need to begin with.

## 7. Start everything

```bash
cd /opt/tracker
docker compose up -d
docker compose ps          # both containers up, api healthy
```

## 8. Publish on your tailnet

Run these on the server; they are safe to repeat.

```bash
sudo tailscale serve --bg --https=443 --set-path=/         http://127.0.0.1:3000
sudo tailscale serve --bg --https=443 --set-path=/mcp      http://127.0.0.1:8787/mcp
sudo tailscale serve --bg --https=443 --set-path=/v1       http://127.0.0.1:8787/v1
sudo tailscale serve --bg --https=443 --set-path=/files    http://127.0.0.1:8787/files
sudo tailscale serve --bg --https=443 --set-path=/healthz  http://127.0.0.1:8787/healthz
tailscale serve status
```

Expected: five mappings, `tailnet only`, and no Funnel.

## 9. Verify

From any device on the tailnet (a browser, or `curl`):

- `https://<host>/healthz` answers `{"ok":true}`.
- `https://<host>/` loads the dashboard. A `403` means your login is not in `DASHBOARD_ALLOWED_LOGINS`.
- `https://<host>/mcp` answers `401` without a token. That is correct.

## 10. Connect your agents

Create one token per tool and machine, so writes are attributed and one machine can be revoked alone:

```bash
cd /opt/tracker && docker compose exec -T api node dist/traccia.js token create --name opencode-mac --actor agent
```

Then configure the tool. The full walkthrough for Claude Code, Codex and OpenCode is in [`docs/agent-setup.md`](agent-setup.md). Confirm it worked by asking the agent to call `whoami`; it should return your `tokenName`.

To make an agent follow the tracker's conventions (search before creating, reference issues by identifier, keep status honest), paste [`docs/agent-snippet.md`](agent-snippet.md) into that repo's `AGENTS.md`.

## 11. Back it up

A daily database snapshot runs on the server, and you can pull snapshots plus attachments to another machine. Install the timer and read the restore procedure in [`docs/backup-restore.md`](backup-restore.md).

## Updating

```bash
cd traccia && git pull
docker buildx build --platform linux/amd64 --load -f apps/api/Dockerfile -t traccia-api:latest .
docker buildx build --platform linux/amd64 --load -f apps/web/Dockerfile -t traccia-web:latest .
cd /opt/tracker && docker compose up -d
```

The compose file pins `TAG=latest` by default, so `up -d` picks up the rebuilt images. Migrations run on startup and are forward-only. Take a snapshot first if a release touches the schema (see [`docs/backup-restore.md`](backup-restore.md)).

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `BASE_URL` error on startup | `BASE_URL` is missing or not a URL. Set `BASE_URL=https://<host>` in `.env`. |
| Dashboard returns `403` | Your login is not in `DASHBOARD_ALLOWED_LOGINS`. Add the exact Tailscale login (email), or check the header `tailscale serve` adds. |
| Dashboard loads but is empty, API `401` inside the containers | `TRACCIA_API_TOKEN` is empty or wrong. Re-mint a `you` token and restart. |
| `https://<host>` does not resolve | The device is not on the tailnet. Connect Tailscale and retry. |
| `tailscale serve` fails about certificates | Enable HTTPS Certificates and MagicDNS in the admin console, then retry. |
| `Address already in use` on 443 | Another `tailscale serve` config holds 443. Inspect with `tailscale serve status` and reset with `tailscale serve reset` if it is stale. |
| Containers restart in a loop on a small box | The host is out of memory. Add swap, or build on a bigger machine and ship the images. |
