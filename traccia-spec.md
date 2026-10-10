# Traccia (formerly "Tracker"): a minimal self-hosted Linear replacement for solo dev + agents

Status: draft v0.1 (spec phase)
Owner: the project owner
Audience: the project owner, and the coding agents that will build it. Written so an agent can build from it phase by phase.

---

## 1. Purpose

A small issue tracker for one human and their AI agents. It replaces a paid Linear plan that is mostly unused (no team, no collaboration).

The agents' main interface is an **MCP server** that mirrors Linear's MCP tool names and shapes, so existing agent prompts and habits keep working. The human interface is a **dashboard** (table grouped by status, plus Kanban).

### Goals
- Create, edit, delete, and restore issues, comments, projects, milestones, labels.
- Attach screenshots to issues.
- Sub-issues, priority, estimates, "blocked by" relations.
- Two actors only: `agent` and `you`. Every write is attributed. Issues can be assigned to either.
- Full-text search that agents can use without knowing IDs.
- Soft deletes by default. An agent mistake must be recoverable.
- One SQLite file plus one attachments folder = the entire state.
- Low RAM footprint (the VPS has about 1.8 GiB free and no swap).
- **Private by default:** nothing is exposed to the public internet; access is over Tailscale only (see section 3).

### Non-goals (v1)
Teams, multiple users, permissions, cycles/sprints, custom statuses, custom fields, notifications, integrations (GitHub, Slack), time tracking, roadmaps, real-time collaboration, mobile app. (A per-project knowledge layer — memories and documents — was a v1 non-goal and is now in scope; see [ADR 0014](docs/adr/0014-project-documentation-memories-and-documents.md).)

---

## 2. Decision log

| # | Topic | Decision |
|---|-------|----------|
| 1 | Hosting | Own VPS (already available) |
| 2 | Backend | Standalone **TypeScript + Hono** service, REST + MCP, SQLite |
| 3 | Dashboard | **Next.js (App Router) + shadcn/ui, self-hosted on the VPS** (built off-box, run with `next start`), talks only to the REST API over localhost. Vercel is no longer used |
| 4 | Database | **SQLite** (better-sqlite3, WAL mode, FTS5), owned by the backend, on the VPS |
| 5 | ORM | Drizzle ORM + drizzle-kit migrations |
| 6 | Data model | Projects, milestones, issues (sub-issues, priority, estimate, blockers), comments, labels, attachments. **Fixed statuses.** |
| 7 | Identifiers | `MAT-123`. **One shared key (`MAT`) across all projects**, matching Linear (one team, many projects). The key and its counter live in `issue_keys`; projects reference a key (see 6.2) |
| 8 | Linear migration | One-time import script, **after** a pilot on one new project |
| 9 | Attachments | Files on VPS disk, served via authenticated routes, behind a storage interface (R2/S3 later) |
| 10 | MCP | Coarse Linear-style tools + explicit delete tools |
| 11 | Deletes | **Soft by default**; permanent purge is restricted (see 9) |
| 12 | Dashboard v1 | Table grouped by status + Kanban, with a toggle. Dedicated design phase before the real build |
| 13 | Actors | Exactly two: `agent`, `you`. Plain field so named agents can be added later |
| 14 | Activity | Per-issue activity timeline |
| 15 | Auth v1 | Static bearer tokens (revocable, hashed) + dashboard access gated by Tailscale identity (password fallback). OAuth-ready design |
| 16 | Auth later | OAuth 2.1 on the MCP endpoint (phase 2), so it works as a claude.ai custom connector |
| 17 | Text format | Markdown for descriptions and comments |
| 18 | Search | SQLite FTS5 over titles, descriptions, comments |
| 19 | Quality bar | Service-layer unit tests + MCP end-to-end tests; README + `docs/agent-snippet.md` |
| 20 | Network | **Everything tailnet-only** via Tailscale (`tailscale serve`), one MagicDNS hostname, path-routed. No public exposure, no domain required. A custom domain remains optional (config placeholder `<BASE_URL>`) |
| 21 | Deployment | **Docker Compose** in `/opt/tracker` on the VPS (`<your-server>`); images built on the dev Mac and loaded with `docker save \| ssh <your-server> docker load` (no registry, no CI); 4 GB swapfile; Biome + pnpm workspaces. Published by `tailscale serve` on port 443 (see 3.1) |
| 22 | Rollout | Build, pilot on one new project for 1-2 weeks, then import + cut over |
| 23 | Knowledge | Per-project **Documentation**: **memories** (titled markdown + free-form tags) and **documents** (files). Project-scoped, editable in place, soft-delete with agent purge allowed for these two types. Decoupled from issues (link a document by URL). See [ADR 0014](docs/adr/0014-project-documentation-memories-and-documents.md), [ADR 0015](docs/adr/0015-agents-may-purge-memories-and-documents.md) |

---

## 3. Architecture

```
 Agents on your machines (Claude Code, Codex, ...)       You (browser / phone with Tailscale app)
        |  all on the tailnet                                   |
        |  MCP: https://<traccia-host>/mcp                      |  https://<traccia-host>/
        |  Authorization: Bearer <agent token>                  |
        v                                                       v
 +--- VPS (tailnet node) -------------------------------------------------+
 |  tailscale serve (HTTPS, MagicDNS name, path routing)                  |
 |     /mcp, /v1/*, /files/*, /healthz  ->  api   (127.0.0.1:8787)        |
 |     /*                               ->  web   (127.0.0.1:3000)        |
 |                                                                        |
 |  web: Next.js (next start, standalone build)                           |
 |     server-side calls only -> http://127.0.0.1:8787 (or compose net)   |
 |                                                                        |
 |  api: Hono service (one Node process): REST + MCP + attachments        |
 |     Service layer (all business rules live here)                       |
 |        |                                                               |
 |     SQLite (WAL) /data/traccia.db      /data/attachments/...           |
 +------------------------------------------------------------------------+
```

Principles:
1. **One service layer.** MCP tools and REST handlers are thin adapters over the same functions. No business logic in either adapter.
2. **Dashboard never touches the DB.** It calls the REST API from server-side code only (server components, server actions, route handlers), using a `you`-actor token held in the web container's environment. The token never reaches the browser.
3. **Private network only.** Both services bind to `127.0.0.1` (or an internal Docker network) and are published to the tailnet only through `tailscale serve`. Nothing listens on a public interface. Verify with an external port scan after deploy.
4. **One hostname, path-routed.** Agents and the browser use the same MagicDNS name (e.g. `traccia.<tailnet>.ts.net`). No CORS needed (same origin; browsers never call the API directly).
5. **Defense in depth.** Tailscale ACLs control *which devices* can reach the node; bearer tokens control *which actor* is calling. Both stay on.
6. **Single writer.** One backend process owns the SQLite file. Do not run two instances against it.
7. **Everything stateful lives under `DATA_DIR`** (default `/data`): the DB and attachments. Config is env vars. This keeps it deployable under Docker or systemd.

### 3.1 Tailscale setup
- The VPS is an existing tailnet node (hostname `<your-tailnet-host>`). It stays untagged and user-owned: **no `tag:traccia` and no ACL change in v1** (the node is shared with other apps; access is bounded by the tailnet itself plus bearer tokens and the dashboard access check). Revisit if other people join the tailnet.
- Publish with `tailscale serve` on **HTTPS 443** (Tailscale-issued certificate), mapping paths to local ports as in the diagram: `/` to the dashboard (`127.0.0.1:3000`), `/mcp` and `/v1/*` to the API (`127.0.0.1:8787`). `BASE_URL` is `https://<your-tailnet-host>`. Port 443 on that node was freed for the tracker (no serve config remained, verified 2026-10-04); the old `/` -> 3773 entry is gone. Exact commands to be verified against the installed Tailscale version (1.102.4).
- **Do not enable Funnel** in v1 (Funnel makes the service public).
- Caveats:
  - Any machine or runtime that needs the tracker must be on the tailnet. Cloud-hosted agents and CI that are not on the tailnet cannot reach it (they would need a Tailscale auth key / ephemeral node, or a later public path).
  - Phones need the Tailscale app connected to open the dashboard.
  - **claude.ai and the mobile app connectors cannot reach a tailnet-only server** (they call from Anthropic's servers). This is accepted for v1. The OAuth phase (7.4) would expose only the `/mcp` path publicly (via Funnel on a separate hostname/path, or a public reverse proxy), leaving the dashboard and REST API private. Verify Funnel path-level options when that phase starts.
- The `tailscale serve` proxy adds identity headers (e.g. `Tailscale-User-Login`) for requests coming from tailnet users. The services must only trust these headers because they listen on localhost and are reachable solely through `tailscale serve`.

---

## 4. Prerequisites (do before any build work)

1. **Add a 4 GB swapfile on the VPS** (decided). The box has no swap and about 1.9 GiB available; any spike invokes the OOM killer. This is the one change to the shared VPS and needs the owner's explicit go-ahead when it is done.
2. **Never run `next build` or `next dev` on the VPS.** Both images (`api` and `web`) are built on the dev Mac (linux/amd64), using Next.js `output: 'standalone'` for the dashboard, and loaded onto the VPS over the tailnet. The VPS only runs `node server.js` inside the containers. `better-sqlite3` ships prebuilt binaries for common platforms; verify that the image gets one rather than compiling.
3. **VPS inspection (DONE, 2026-10-04).** `<your-server>`: Ubuntu 24.04 x86_64, 2 vCPU, 3.7 GiB RAM, no swap, 11 GB disk free, Docker 29.5 (only a Postgres container; other apps run under systemd), Tailscale 1.102.4, no backup process, ports 3000 and 8787 free. Port 443 was taken by an old serve entry and has since been freed.
4. **No Tailscale ACL tag** in v1 (see 3.1).

Expected steady-state memory: backend roughly 80-150 MB; dashboard (`next start`) roughly 200-400 MB. Total about 0.3-0.55 GB, which fits the headroom only with the swapfile in place. If memory gets tight, fall back to serving a static dashboard build from the Hono service (no Next server).

---

## 5. Tech stack

| Concern | Choice |
|---------|--------|
| Runtime | Node.js LTS (22+) |
| Language | TypeScript (strict) |
| HTTP | Hono + `@hono/node-server` |
| Validation | Zod (shared by REST and MCP; MCP SDK uses Zod schemas) |
| DB | SQLite via `better-sqlite3` (synchronous, fast, simple transactions) |
| ORM / migrations | Drizzle ORM + drizzle-kit (SQL migrations checked into the repo) |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP transport, **stateless** mode |
| IDs | ULID (`ulid` package) for internal IDs |
| Tests | Vitest |
| Dashboard | Next.js App Router (standalone output), React, Tailwind, shadcn/ui, TanStack Table, dnd-kit, TanStack Query or SWR |
| Lint/format | Biome or ESLint + Prettier (pick one at repo creation) |

Note on MCP + Hono: the SDK's Streamable HTTP transport has historically been written for Node `req`/`res`. Check the current SDK for a web-standard (Fetch API) transport first. If unavailable, use the raw Node request/response objects exposed by `@hono/node-server` and delegate `/mcp` to the SDK transport. Verify against current SDK docs at build time rather than assuming.

Repo layout (monorepo, pnpm workspaces). **Traccia is built inside the existing repo (originally `linear-matti`, renamed `traccia` with the product), at its root** (decision: no separate repo or folder). This spec stays at the root as `traccia-spec.md`. The root `AGENTS.md` already holds the repo's agent-skills configuration and is left as is; the tracker's own agent snippet goes in `docs/agent-snippet.md` instead. `docs/` already exists (`docs/agents/`, `docs/adr/`) and is shared.

```
traccia/             # repo root (originally linear-matti)
  apps/
    api/            # Hono service: REST + MCP + attachments
      src/
        config.ts
        db/         # drizzle schema, migrations, connection
        service/    # business logic (the only place rules live)
        rest/       # REST routes (thin)
        mcp/        # MCP server + tool definitions (thin)
        auth/       # token verification, actor resolution
        storage/    # AttachmentStorage interface + local-disk impl
        cli/        # token create/revoke, db tools, import
      test/
    web/            # Next.js dashboard (self-hosted on the VPS)
  packages/
    shared/         # zod schemas, types, constants (statuses, priorities)
  deploy/           # compose file, deploy script, backup scripts
  AGENTS.md         # existing: agent-skills config (do not replace)
  README.md
  docs/             # shared with existing docs/agents; adds agent-snippet.md, mcp-tools.md, agent-setup.md, backup-restore.md
  traccia-spec.md   # this spec
```

---

## 6. Data model

### 6.1 Conventions
- Internal IDs: ULID strings (text, sortable).
- Timestamps: ISO 8601 UTC strings (`2026-10-04T10:15:00.000Z`), stored as text.
- SQLite pragmas on every connection: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`.
- Soft delete: every user-facing table has `deleted_at` (nullable) and `deleted_batch` (nullable ULID).
- Actors: `'agent' | 'you'` stored as text with a CHECK constraint. Keep it a plain column so adding named agents later is a small migration.

### 6.2 Identifiers and issue keys

Issue identifiers look like `ABC-123`. The counter lives on the **key**, not directly on the project, so that more than one project can share a key if needed (see open question O1; this matters for importing from Linear, where identifiers come from *teams* and one team usually spans many *projects*).

Allocation: inside a write transaction, `UPDATE issue_keys SET next_number = next_number + 1 WHERE key = ? RETURNING next_number - 1`. Identifiers are never reused, including after deletion or purge.

**Confirmed setup:** all projects use the single key `MAT` (identifiers `MAT-1`, `MAT-2`, ...), exactly as in Linear. This is the normal case, not an edge case.

Behavior:
- Creating a project **without** a `key` uses `DEFAULT_ISSUE_KEY` (default `MAT`). The key row is created on first use if it does not exist.
- Passing an explicit `key` uses that key (creating it if new), so a different prefix remains possible later.
- Because the counter is per key, numbers keep increasing across all projects under `MAT` and are never reused.
- Moving an issue between projects never changes its identifier.

### 6.3 Schema (SQLite DDL, reference)

```sql
CREATE TABLE issue_keys (
  key          TEXT PRIMARY KEY CHECK (key GLOB '[A-Z][A-Z0-9]*' AND length(key) BETWEEN 2 AND 8),
  next_number  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE projects (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL REFERENCES issue_keys(key),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',       -- markdown
  status        TEXT NOT NULL DEFAULT 'active'  -- active | paused | completed | canceled
                CHECK (status IN ('active','paused','completed','canceled')),
  created_by    TEXT NOT NULL CHECK (created_by IN ('agent','you')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  deleted_batch TEXT
);

CREATE TABLE milestones (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  target_date   TEXT,                            -- YYYY-MM-DD
  sort_order    REAL NOT NULL DEFAULT 0,
  created_by    TEXT NOT NULL CHECK (created_by IN ('agent','you')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  deleted_batch TEXT
);

CREATE TABLE issues (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  key           TEXT NOT NULL REFERENCES issue_keys(key),
  number        INTEGER NOT NULL,
  identifier    TEXT NOT NULL UNIQUE,            -- e.g. ABC-123 (key || '-' || number)
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',        -- markdown
  status        TEXT NOT NULL DEFAULT 'backlog'
                CHECK (status IN ('backlog','todo','in_progress','in_review','done','canceled')),
  priority      INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
                -- 0 none, 1 urgent, 2 high, 3 medium, 4 low (same as Linear)
  estimate      INTEGER CHECK (estimate IS NULL OR estimate >= 0),
  assignee      TEXT CHECK (assignee IS NULL OR assignee IN ('agent','you')),
  milestone_id  TEXT REFERENCES milestones(id),
  parent_id     TEXT REFERENCES issues(id),
  sort_order    REAL NOT NULL DEFAULT 0,         -- fractional ordering within a status column
  created_by    TEXT NOT NULL CHECK (created_by IN ('agent','you')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  started_at    TEXT,
  completed_at  TEXT,
  canceled_at   TEXT,
  deleted_at    TEXT,
  deleted_batch TEXT,
  UNIQUE (key, number)
);
CREATE INDEX issues_project_status ON issues(project_id, status) WHERE deleted_at IS NULL;
CREATE INDEX issues_assignee       ON issues(assignee, status)   WHERE deleted_at IS NULL;
CREATE INDEX issues_parent         ON issues(parent_id);
CREATE INDEX issues_milestone      ON issues(milestone_id);
CREATE INDEX issues_updated        ON issues(updated_at);

CREATE TABLE labels (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#6b7280', -- hex
  project_id    TEXT REFERENCES projects(id),    -- NULL = global label
  created_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE UNIQUE INDEX labels_unique_name ON labels(COALESCE(project_id,''), lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE issue_labels (
  issue_id TEXT NOT NULL REFERENCES issues(id),
  label_id TEXT NOT NULL REFERENCES labels(id),
  PRIMARY KEY (issue_id, label_id)
);

CREATE TABLE issue_relations (            -- "blocker blocks blocked"
  blocker_id TEXT NOT NULL REFERENCES issues(id),
  blocked_id TEXT NOT NULL REFERENCES issues(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE comments (
  id            TEXT PRIMARY KEY,
  issue_id      TEXT NOT NULL REFERENCES issues(id),
  parent_id     TEXT REFERENCES comments(id),    -- one level of threading is enough
  body          TEXT NOT NULL,                   -- markdown
  actor         TEXT NOT NULL CHECK (actor IN ('agent','you')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  deleted_batch TEXT
);
CREATE INDEX comments_issue ON comments(issue_id, created_at);

CREATE TABLE attachments (
  id            TEXT PRIMARY KEY,
  issue_id      TEXT NOT NULL REFERENCES issues(id),
  comment_id    TEXT REFERENCES comments(id),    -- optional: attached to a comment
  filename      TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  storage_key   TEXT NOT NULL,                   -- opaque key for the storage backend
  actor         TEXT NOT NULL CHECK (actor IN ('agent','you')),
  created_at    TEXT NOT NULL,
  deleted_at    TEXT,
  deleted_batch TEXT
);

CREATE TABLE activity (
  id         TEXT PRIMARY KEY,
  issue_id   TEXT NOT NULL REFERENCES issues(id),
  actor      TEXT NOT NULL CHECK (actor IN ('agent','you')),
  type       TEXT NOT NULL,                      -- see 6.5
  data       TEXT NOT NULL DEFAULT '{}',         -- JSON, e.g. {"from":"todo","to":"done"}
  created_at TEXT NOT NULL
);
CREATE INDEX activity_issue ON activity(issue_id, created_at);

CREATE TABLE tokens (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,                    -- human label, e.g. "claude-code-laptop"
  actor        TEXT NOT NULL CHECK (actor IN ('agent','you')),
  token_hash   TEXT NOT NULL UNIQUE,             -- sha256 of the token; plaintext never stored
  scopes       TEXT NOT NULL DEFAULT 'all',      -- reserved for later (e.g. 'read')
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
);

-- Per-project knowledge layer (ADR 0014)
CREATE TABLE memories (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',        -- markdown
  tags          TEXT NOT NULL DEFAULT '[]',      -- JSON array of strings
  created_by    TEXT NOT NULL CHECK (created_by IN ('agent','you')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  deleted_batch TEXT
);
CREATE INDEX memories_project ON memories(project_id) WHERE deleted_at IS NULL;

CREATE TABLE documents (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  filename      TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  storage_key   TEXT NOT NULL,                   -- opaque key for the storage backend
  description   TEXT NOT NULL DEFAULT '',
  created_by    TEXT NOT NULL CHECK (created_by IN ('agent','you')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  deleted_batch TEXT
);
CREATE INDEX documents_project ON documents(project_id) WHERE deleted_at IS NULL;
```

### 6.4 Full-text search (FTS5)

```sql
CREATE VIRTUAL TABLE search_index USING fts5(
  kind UNINDEXED,        -- 'issue' | 'comment' | 'memory' | 'document'
  ref_id UNINDEXED,      -- issue id, comment id, memory id or document id
  issue_id UNINDEXED,    -- owning issue (for comments; empty otherwise)
  title,                 -- issue/memory title, or document filename (empty for comments)
  body,                  -- issue description, comment body, memory body, or document description
  tokenize = 'porter unicode61 remove_diacritics 2'
);
```

- Keep the index in sync **inside the service layer transaction** (insert/update/delete rows on every issue/comment write), not with triggers, so soft-delete rules stay in one place. Soft-deleting removes the rows; restoring re-adds them.
- Memories are indexed by `title` + `body`; documents by `filename` + `description`. Document file contents are **not** extracted (no PDF/text parsing), so a document is found by its name and description.
- Query: `search_index MATCH ?` with `bm25()` ranking; results grouped by issue and returned with a snippet.
- Italian content is expected (Italian SMEs). `unicode61 remove_diacritics` handles accents. Porter stemming is English-only; acceptable for v1. Revisit if Italian stemming matters.
- Sanitize user queries before passing to MATCH (quote tokens) so agent input can never cause FTS syntax errors.
- Provide a CLI command `db reindex` that rebuilds the index from source tables.

### 6.5 Activity types

`issue_created`, `title_changed`, `description_changed`, `status_changed`, `priority_changed`, `estimate_changed`, `assignee_changed`, `milestone_changed`, `project_changed`, `parent_changed`, `label_added`, `label_removed`, `blocker_added`, `blocker_removed`, `comment_added`, `comment_deleted`, `comment_restored`, `attachment_added`, `attachment_deleted`, `attachment_restored`, `issue_deleted`, `issue_restored`.

Rules:
- Written in the same transaction as the change.
- Description changes store only a marker (and old length), not a full diff. Full diffs are an explicit non-goal for v1; soft deletes plus this timeline are the safety net.
- A single `save_issue` call that changes several fields writes one activity row per changed field.

### 6.6 Behavioral rules (service layer)

**Status**
- Values: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `canceled`. Display names: Backlog, Todo, In Progress, In Review, Done, Canceled.
- Input is case-insensitive and accepts display names and common separators (`"In Progress"`, `"in-progress"`, `"in_progress"`).
- Moving to `in_progress` sets `started_at` if empty. Moving to `done` sets `completed_at`; to `canceled` sets `canceled_at`. Moving back out of `done`/`canceled` clears them.

**Priority**: 0 none, 1 urgent, 2 high, 3 medium, 4 low (identical to Linear). Accept both numbers and names on input.

**Estimate**: non-negative integer points, nullable. No fixed scale enforced.

**Assignee**: `agent`, `you`, or null.

**Sub-issues**: `parent_id` must be in the same project and must not create a cycle. Max nesting depth: 3 (enforced).

**Blockers**: `blockedBy` / `blocks` are stored as `issue_relations`. Reject self-relations and direct cycles (A blocks B blocks A). Blockers can cross projects.

**Moving an issue between projects**: allowed via `save_issue` with a new `project`. The identifier **does not change** (it keeps the old key). Milestone and parent are cleared if they belong to the old project; sub-issues move with it.

**Milestones**: belong to one project. An issue's milestone must belong to the issue's project.

**Labels**: global or project-scoped. Names unique (case-insensitive) within scope. Unknown label names passed to `save_issue` are **not** auto-created (return an error listing existing labels); label creation is explicit via `save_issue_label`. This prevents agents from littering the workspace with near-duplicate labels.

**Ordering**: `sort_order` (fractional) for Kanban column ordering. The dashboard computes a value between neighbors on drag; the service rebalances when gaps get too small.

---

## 7. Actors, auth, and tokens

### 7.1 Actors
Exactly two: `agent` and `you`.
- Every token maps to one actor. Agent tokens stamp `agent`. The dashboard's token stamps `you`.
- `created_by`, comment `actor`, activity `actor`, and `assignee` all use the same two values.
- The dashboard has filters: Assignee = You / Agent / Unassigned, so "for me" vs "for the agents" is one click.

### 7.2 Tokens (v1)
- Format: `trk_` + 32 random bytes, base64url. Shown **once** at creation.
- Stored as SHA-256 hash only. Compare with constant-time equality.
- Header: `Authorization: Bearer <token>`.
- Managed via CLI on the VPS (no public token endpoint in v1):
  - `traccia token create --name claude-code-laptop --actor agent`
  - `traccia token list`
  - `traccia token revoke <id>`
- Revocation takes effect immediately (look up on each request; it is one indexed query).
- `last_used_at` updated at most once a minute per token to avoid write churn.
- Basic rate limiting per token (in-memory, e.g. 120 req/min) to contain runaway agent loops.

### 7.3 Dashboard access
- The network already restricts access to your tailnet devices. On top of that, the dashboard checks the **Tailscale identity header** (`Tailscale-User-Login`) against an allowlist (`DASHBOARD_ALLOWED_LOGINS`, e.g. your Tailscale login). Valid only because the web service listens on localhost behind `tailscale serve`; reject the header if the request did not come from the local proxy.
- **Fallback** if the identity header is unavailable (e.g. serve configuration changes): single-user password login with `DASHBOARD_PASSWORD_HASH` + `SESSION_SECRET` and a signed httpOnly session cookie.
- All API calls from the dashboard are server-side and use `TRACCIA_API_TOKEN` (a `you` actor token) from the web container's environment (not `NEXT_PUBLIC_`).

### 7.4 OAuth (phase 2, designed for now)
Goal: use the MCP server from claude.ai / mobile as a custom connector.
- Put token verification behind an interface: `verifyCredential(request) -> { actor, tokenId } | null`. v1 implements the bearer-token verifier. Phase 2 adds an OAuth access-token verifier (OAuth 2.1 with PKCE, per the MCP authorization spec: protected-resource metadata, authorization server metadata, dynamic client registration). Check the current MCP authorization spec at build time.
- Requires making `/mcp` (and the OAuth endpoints) publicly reachable while everything else stays tailnet-only (see 3.1). Single-user consent screen gated by Tailscale identity or the dashboard password.
- OAuth sessions map to actor `agent` or `you` chosen at consent time.

---

## 8. Attachments

- Storage behind an interface:
  ```ts
  interface AttachmentStorage {
    put(key: string, data: Buffer | Readable, meta: { mimeType: string }): Promise<void>;
    get(key: string): Promise<{ stream: Readable; size: number }>;
    delete(key: string): Promise<void>;
  }
  ```
  v1 implementation: local disk at `${DATA_DIR}/attachments/<yyyy>/<mm>/<id>`. A future S3/R2 implementation slots in without touching the service layer.
- **Allowed types** (v1): `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `application/pdf`, `text/plain`, `text/markdown`, `application/json`. Validate by **sniffing magic bytes**, not just the declared MIME type.
- **Size limit**: default 10 MB per file (`MAX_ATTACHMENT_BYTES`). MCP base64 uploads are limited further (default 5 MB) because they inflate the request.
- **Upload paths**
  - REST: `POST /v1/issues/:identifier/attachments` (multipart/form-data). Best for the dashboard and for agents with shell access (`curl -F`).
  - MCP: `create_attachment` takes **either** `contentBase64` **or** `sourceUrl` (the server fetches it; HTTPS only, size-capped, with SSRF protection: block private/loopback/link-local ranges, no redirects to them). Remote MCP servers cannot read an agent's local file paths, which is why a path parameter is not offered.
- **Download**: `GET /files/:attachmentId` with Bearer auth. Never publicly accessible. Sets `Content-Type` from stored MIME, `X-Content-Type-Options: nosniff`, and `Content-Disposition: attachment` for anything that is not an image or PDF.
- **Dashboard rendering**: the browser has no API token, so the Next.js app exposes a route handler (`/api/files/[id]`) that streams the file from the API using the server-side token. Images in markdown reference that route.
- **MCP retrieval**: `get_attachment` returns metadata and, for images up to a size cap, an MCP `image` content block so a multimodal agent can actually look at the screenshot.
- Filenames are sanitized; the on-disk key never contains user-supplied path segments.
- Deleting an attachment is soft (DB row flagged, file kept). Purge deletes the file.

---

## 9. Soft delete and restore

- Default delete sets `deleted_at` and a `deleted_batch` ULID on the target and its dependents in one transaction.
- **Cascade rules** (all share the same `deleted_batch`, so restore undoes the whole action):
  - Delete project: hides its milestones and issues (and their comments/attachments).
  - Delete milestone: milestone hidden; issues stay, with `milestone_id` set to null (recorded in activity).
  - Delete issue: hides its sub-issues, comments, and attachments.
  - Delete comment: hides its replies and attachments.
  - Delete attachment: hides that attachment.
- **Restore**: `restore` tool/endpoint takes a type and id and restores the whole batch. Restoring re-adds search index rows.
- **Lists** exclude deleted rows by default. `includeDeleted: true` shows them (flagged `deleted: true`) so agents and the dashboard can find and restore items.
- **Purge (permanent)**:
  - All delete tools accept `purge: boolean` (default false). Purge is only allowed on items that are **already soft-deleted** (two-step by design).
  - **Agents cannot purge by default** (`ALLOW_AGENT_PURGE=false`). Purge is available to the `you` actor via the dashboard ("Trash" view) and the CLI. Flip the env var if you later want agents to purge.
  - Purge removes DB rows, search rows, and attachment files. Issue numbers are not reused.
- **Trash retention**: no automatic purge in v1 (state is small). Optional later: purge items deleted more than N days ago.

---

## 10. REST API

Base: `<BASE_URL>/v1`. JSON in/out. Bearer auth. Zod-validated. Consistent error shape:

```json
{ "error": { "code": "validation_error", "message": "…", "details": { } } }
```

Codes: `unauthorized`, `forbidden`, `not_found`, `validation_error`, `conflict`, `rate_limited`, `internal`.

Pagination: cursor-based (`?limit=50&cursor=…`), `limit` max 250. Response: `{ "items": [...], "nextCursor": "…" | null }`.

Issues are addressed by **identifier** (`ABC-123`) in URLs; ULIDs are also accepted.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/projects` | filters: `status`, `includeDeleted` |
| POST | `/projects` | |
| GET / PATCH / DELETE | `/projects/:idOrKey` | DELETE accepts `?purge=true` |
| GET / POST | `/projects/:idOrKey/milestones` | |
| GET / PATCH / DELETE | `/milestones/:id` | |
| GET | `/issues` | filters below |
| POST | `/issues` | |
| GET / PATCH / DELETE | `/issues/:identifier` | GET supports `?include=comments,activity,attachments,children,relations` |
| POST | `/issues/:identifier/restore` | |
| PATCH | `/issues/:identifier/position` | `{ status, beforeId?, afterId? }` for Kanban drag-and-drop |
| GET / POST | `/issues/:identifier/comments` | |
| PATCH / DELETE | `/comments/:id` | |
| POST | `/issues/:identifier/attachments` | multipart |
| GET / DELETE | `/attachments/:id` | metadata / soft delete |
| GET | `/files/:attachmentId` | binary download (also available at root `/files`) |
| GET / POST | `/labels` | |
| PATCH / DELETE | `/labels/:id` | |
| POST | `/restore` | `{ type, id }` generic restore |
| GET | `/search` | `?q=…&project=…` returns issues with snippets |
| GET | `/activity` | recent activity feed across issues (dashboard) |
| GET | `/me` | returns `{ actor, tokenName }` |
| GET | `/healthz` | unauthenticated, returns `{ ok: true }` only |

Issue list filters: `project`, `status` (repeatable), `assignee` (`agent|you|none`), `label` (repeatable), `milestone`, `parent`, `priority`, `q`, `createdBy`, `updatedAfter`, `includeDeleted`, `orderBy` (`updatedAt|createdAt|priority|sortOrder`), `order`.

Concurrency: PATCH accepts optional `If-Match: <updated_at>` (or `expectedUpdatedAt` in the body). If provided and stale, return `409 conflict`. This keeps a dashboard edit from silently overwriting an agent's concurrent change.

---

## 11. MCP server

- Endpoint: `<BASE_URL>/mcp`, Streamable HTTP, **stateless** (new server instance per request is fine; no session state needed).
- Auth: same Bearer token. Actor taken from the token and stamped on all writes.
- Server name: `traccia`. Version from `package.json`.
- Tool design principles:
  1. **Mirror Linear's MCP naming and argument shapes** where one exists (`list_issues`, `get_issue`, `save_issue`, `save_comment`, `list_projects`, `save_project`, ...), so existing agent prompts keep working.
  2. `save_*` = create when no `id` is given, update when `id` is given.
  3. Accept human-friendly references: project by key or name, issue by identifier, status by name, labels by name, milestone by name.
  4. Responses are compact JSON (as text content, plus `structuredContent`). Omit empty fields. Descriptions truncated in list views (full text in `get_*`).
  5. Errors use `isError: true` with an **actionable** message ("Unknown label 'bugg'. Existing labels: bug, feature, chore. Use save_issue_label to create one.").
  6. Tool descriptions are terse but state enums, defaults, and gotchas, since they cost context on every agent session.
- Tool list (about 30): see Appendix A.
- Resources and prompts (e.g. `issue://ABC-123`, a "triage backlog" prompt): **deferred**, add after observing real agent usage.
- Provide an agent snippet (`docs/agent-snippet.md`) teaching agents the workflow conventions (see section 15).

---

## 12. Dashboard (Next.js + shadcn, self-hosted on the VPS)

### 12.1 v1 scope
- **Issues view**: one page with a view toggle:
  - **Table**: issues grouped by status (collapsible groups, counts), columns: identifier, title, labels, assignee, priority, estimate, milestone, updated.
  - **Kanban**: columns per status, drag and drop (dnd-kit) with persisted ordering.
- Filters: project, assignee (You / Agent / Unassigned), labels, priority, milestone, text search (FTS).
- **Issue detail**: edit all fields, markdown description (render + edit), comments, attachments (drag-drop upload, image preview), sub-issues, blockers, activity timeline.
- **Project page**: description, milestones with progress, issue list.
- **Trash view**: list soft-deleted items, restore, purge (you only).
- Create issue dialog (title, project, status, assignee, priority, labels).
- Dark and light themes.

### 12.2 Data refresh
Agents change data while the dashboard is open. v1: polling with TanStack Query/SWR (e.g. every 10-15 s on the Kanban/table views, paused when the tab is hidden) plus revalidate on focus. Server-sent events are a later improvement.

### 12.3 Look and feel
Linear / Vercel / Resend / shadcn vibes as the baseline: dense but calm, neutral palette, subtle borders, excellent typography.

### 12.4 Dedicated design phase (before building the real UI)
The dashboard should be "impeccable and exactly as wanted", so design happens **before** implementation:
1. Collect reference repos and screenshots (the owner's picks).
2. Optional: a survey of existing open-source Linear clones on GitHub (stack, data model, UI patterns worth borrowing, licenses). Run when requested; findings get appended to this spec.
3. Build clickable prototypes (static or mock-data Next.js pages) for: table grouped by status, Kanban, issue detail, project page, and the toggle behavior.
4. Review and iterate until approved.
5. Only then wire to the API.
The REST API and MCP server are built first and do not depend on this phase.

### 12.5 Dashboard technical rules
- All API access in server components / server actions / route handlers via a `server-only` API client pointed at the local API (`TRACCIA_API_URL`, e.g. `http://api:8787`). Never expose `TRACCIA_API_TOKEN` to client bundles (no `NEXT_PUBLIC_` prefix).
- Types and Zod schemas come from `packages/shared`.
- Attachments proxied through `/api/files/[id]`.
- Access check (7.3) required on every route (middleware).

---

## 13. Configuration

Everything configurable via env vars (validated with Zod at startup; fail fast with a clear message). A single `config.ts` is the only reader of `process.env`.

**Backend (VPS)**

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8787` | HTTP port |
| `DATA_DIR` | `/data` | SQLite file + attachments |
| `BASE_URL` | (required) | Externally visible base URL, e.g. `https://<your-tailnet-host>` (used to build attachment links in responses) |
| `MAX_ATTACHMENT_BYTES` | `10485760` | Per-file cap |
| `MAX_MCP_UPLOAD_BYTES` | `5242880` | Base64 upload cap |
| `DEFAULT_ISSUE_KEY` | `MAT` | Issue prefix used when a project is created without an explicit key |
| `ALLOW_AGENT_PURGE` | `false` | Whether `agent` tokens may purge |
| `RATE_LIMIT_PER_MIN` | `120` | Per token |
| `LOG_LEVEL` | `info` | |
| `TRUST_PROXY` | `true` | Read client IP from `X-Forwarded-For` when behind a proxy |

**Dashboard (web container on the VPS)**: `TRACCIA_API_URL`, `TRACCIA_API_TOKEN`, `DASHBOARD_ALLOWED_LOGINS`. (`DASHBOARD_PASSWORD_HASH` and `SESSION_SECRET` exist only if the fallback login in 7.3 is built, which happens only if the deploy-time header check fails.)

Hostname: the default is the node's MagicDNS name (`<node>.<tailnet>.ts.net`), so no domain purchase or DNS work is needed. If you later want a custom domain (for example for the OAuth phase), only `BASE_URL` and the proxy config change; nothing in code hardcodes a host.

---

## 14. Deployment and backups

### 14.1 Deployment (decided)
Docker Compose in `/opt/tracker/` on `<your-server>`, same pattern as the existing Postgres stack's `/opt/postgres/docker-compose.yml`:
- Two services: `api` (Hono, port 8787) and `web` (Next.js standalone, port 3000), both bound to localhost, never to a public interface. `restart: unless-stopped`.
- `tailscale serve` is the only publisher (3.1), on port 443.
- Single data directory (`/data` volume), config from env vars.
- `GET /healthz` on the API for container health checks.
- Images built on the dev Mac (linux/amd64, buildx) and shipped with `docker save | ssh <your-server> docker load`, then `docker compose up -d`. No registry, no CI in v1. A deploy script in the repo wraps these steps. No builds on the VPS.
- Memory limits: `api` 256 MB, `web` 512 MB, with a 4 GB swapfile on the host.
- Repo tooling: Biome (lint and format) and pnpm workspaces; pnpm is dev-only.
- Docker caveat: published ports must be bound to `127.0.0.1` (e.g. `127.0.0.1:8787:8787`); Docker's default publishing bypasses some firewall rules.

### 14.2 Backups (decided)
- A **daily** job on the VPS writes a consistent DB snapshot using SQLite's online backup (`better-sqlite3` backup / `VACUUM INTO`, run from Traccia's own runtime because the host has no `sqlite3` CLI). Never a plain file copy of the live DB. Default: keep the last 3 snapshots on the VPS.
- The **Windows machine pulls manually** over the tailnet (documented rsync-style script): latest snapshot plus `/data/attachments`. Keep the last 3 copies there. Accepted: the off-box copy can be stale, and losing some recent work is tolerable in v1. No Litestream, no cloud account.
- Document a tested **restore** procedure in the README (restore the Windows copy into a scratch folder or container, start the service on it, check issues and attachments load) and run it once before the pilot ends.
- No backup process existed on the VPS, so there is nothing to integrate with.

---

## 15. Testing and documentation

### Tests (Vitest)
- **Service layer unit tests** against an in-memory (or temp-file) SQLite with migrations applied. Cover: identifier allocation (including concurrency), status transitions and timestamps, sub-issue depth and cycle rules, blocker cycles, moving issues between projects, label rules, soft delete cascades and batch restore, purge rules, FTS sync (insert/update/delete/restore), activity rows, optimistic concurrency.
- **MCP end-to-end tests**: start the real server, connect with the SDK's MCP client, call every tool with valid and invalid input, assert on output shape and error messages. Include a **tool-list snapshot test** so any change to tool names or schemas is deliberate (the tools are the contract agents depend on).
- **Auth tests**: missing/invalid/revoked token, actor stamping, agent purge denied.
- **Attachment tests**: magic-byte validation, size limits, SSRF blocklist for `sourceUrl`, download auth.
- Dashboard: no automated tests required in v1 beyond type-checking and a smoke test; revisit after the design phase.

### Documentation
- `README.md`: what it is, architecture, local dev, config table, deploy notes, backup/restore.
- `docs/agent-snippet.md` (the AGENTS.md-style guide for agents using the tracker, also usable as a snippet in other repos):
  - Always `list_issues` / search before creating duplicates.
  - Reference issues by identifier in commits and comments.
  - Status conventions (move to In Progress when starting, In Review when a PR/diff is ready, Done only when verified).
  - Comment with progress and decisions, not noise.
  - Attach screenshots for UI bugs.
  - Use labels that already exist; do not invent new ones.
  - Never delete without being asked; deletes are soft and restorable; do not try to purge.
  - Assign to `you` when human input or a decision is needed.
- `docs/mcp-tools.md` generated from the tool definitions.

---

## 16. Linear import and cutover

### 16.1 Rollout order
1. Build and deploy the tracker (phases 0-6 below).
2. **Pilot**: use it for one new project for 1-2 weeks, with agents on the new MCP server. Keep Linear for everything else.
3. Review pilot findings; fix rough edges.
4. Decide import scope: everything, or open issues and active projects only.
5. Run the import, switch all agents to the new MCP server, then cancel the Linear plan once satisfied.

### 16.2 Import script (CLI: `traccia import linear`)
- Source: Linear GraphQL API with a personal API key (read-only use).
- Imports: projects, project milestones, issues (title, description, status, priority, estimate, assignee mapping, labels, parent/child, blocks/blocked-by, created/updated/completed timestamps), comments (with original author mapped to `you` or `agent`, original name noted in the text), and attachments/images (downloaded and re-stored).
- **Keeps original identifiers** (e.g. `MAT-123`) and sets the `MAT` key's `next_number` above the highest imported number. All Linear projects map to Traccia projects under the shared `MAT` key.
- Status mapping: Linear workflow states map by *type* (backlog, unstarted, started, completed, canceled) to the six fixed statuses; "In Review" is matched by name.
- Idempotent: re-running updates instead of duplicating (store Linear IDs in a mapping table `import_map`).
- Dry-run mode prints counts and anomalies without writing.
- Respect Linear API rate limits (paginate, back off).
- Inline images in Linear markdown are re-hosted as attachments and rewritten.
- Each imported issue gets an activity row `issue_created` with a note `imported from Linear`.

### 16.3 Cutover
- Update agent MCP configs (Claude Code settings, Codex config, etc.) and the agent snippet.
- Optionally run both MCP servers for a short overlap; no continuing two-way sync.
- Export a final Linear JSON backup before canceling.

---

## 17. Build plan (phases)

Each phase ends with passing tests and a short demo.

**Phase 0: Prerequisites**
- Add 4 GB swapfile (needs explicit go-ahead). Create repo and tooling (Biome, pnpm workspaces), Dockerfiles, and the build-on-Mac deploy script (no CI). VPS inspection and domain placement are already decided.

**Phase 1: Core service + DB**
- Schema, migrations, config, service layer for projects, milestones, issues, labels, comments, relations, activity, soft delete/restore, FTS.
- Unit tests for all rules in 6.6 and 9.

**Phase 2: REST API + auth**
- Hono routes, error shape, pagination, tokens table, CLI for tokens, rate limiting, `/healthz`, `/me`.

**Phase 3: MCP server**
- All tools in Appendix A, stateless Streamable HTTP at `/mcp`, e2e tests, tool-list snapshot.
- Smoke test from a real agent (Claude Code) against a local instance.

**Phase 4: Attachments**
- Storage interface + local-disk implementation, multipart upload, MCP `create_attachment` / `get_attachment`, download route, validation, SSRF protection, tests.

**Phase 5: Deploy backend**
- Compose stack in `/opt/tracker`, publish with `tailscale serve` on 443 (no tag or ACL change), daily snapshot job and Windows pull script, create tokens, confirm nothing new is publicly reachable, verify the identity header from Mac and Windows, test restore.

**Phase 6: Docs for agents**
- README, `docs/agent-snippet.md`, generated MCP tool docs.

**Phase 7: Dashboard design (prototype phase)**
- Reference repos, optional Linear-clone survey, clickable prototypes, approval. (Can run in parallel with phases 1-6.)

**Phase 8: Dashboard build**
- Next.js + shadcn (standalone build, shipped as a Docker image to the VPS): access check, table/Kanban toggle, issue detail, project page, trash, polling refresh.

**Phase 9: Pilot**
- One new project, 1-2 weeks, collect friction notes.

**Phase 10: Import and cutover**
- Import script, scope decision, switch agents, cancel Linear.

**Phase 11 (later): OAuth** for claude.ai connector use (requires publishing `/mcp` publicly; see 3.1). Optional: SSE live updates, named agents, MCP resources/prompts, cycles, S3/R2 storage, REST-based integrations.

---

## 18. Open questions

- **O1 (RESOLVED): identifier prefixes.** All projects use the single key `MAT`; the shared-key design in 6.2 handles it, and the Linear import keeps every `MAT-n` identifier valid. Original note, kept for context: **identifier prefixes vs Linear's model.** In Linear, `ABC-123` comes from a *team*, and a team normally contains many *projects*. This spec puts the prefix on the project (as decided) but stores the counter on a separate `issue_keys` table, so several projects can share one key. Confirm during the import design: if your Linear workspace has one team spanning many projects, you want those projects to share a key (e.g. all `BD-*`) so old identifiers stay valid. If each of your projects already has its own team/key, the default one-key-per-project works as is.
- **O2 (RESOLVED): Domain/exposure.** Tailnet-only via `tailscale serve` on a MagicDNS hostname; no domain needed. A custom domain is only relevant for the future OAuth phase.
- **O3 (RESOLVED): VPS deployment alignment.** Docker Compose on `<your-server>`, serve on port 443 (freed), Mac-built images, 4 GB swap (sections 3.1, 14.1).
- **O4 (RESOLVED): Backups.** Daily snapshot on the VPS, manual pull to the Windows machine, keep 3 (section 14.2).
- **O5: Dashboard design.** Reference repos and prototypes (section 12.4).
- **O6: Import scope.** Everything vs open issues only; decided after the pilot.
- **O7: OAuth.** Phase 2; confirm which clients need it (claude.ai custom connector, mobile).
- **O8 (RESOLVED): Dashboard login.** Identity header check only (`Tailscale-User-Login` vs `DASHBOARD_ALLOWED_LOGINS`); the password fallback (7.3) is built only if the deploy-time header check from Mac and Windows fails. Local header forging by other processes on `<your-server>` is accepted for v1; document in the README.
- **O11 (RESOLVED): Non-tailnet clients.** v1 agent hosts are Claude Code/Codex on the Mac and the Windows machine, both on the tailnet. CI, cloud agents and phone are unsupported until the OAuth phase.
- **O12: Memory headroom.** Dashboard adds about 200-400 MB; confirm after the 4 GB swap is in place. Fallback: static dashboard served by the API.
- **O9: Italian-language search quality.** FTS5 with `unicode61` is language-agnostic but stems English only; revisit if search quality in Italian content is poor.
- **O10 (RESOLVED): Agent purge.** Disabled by default (`ALLOW_AGENT_PURGE=false`); confirmed.

---

# Appendix A: MCP tool schemas

All tools are served by the MCP endpoint at `/mcp`. Schemas below use Zod (TypeScript). Shared definitions first.

```ts
import { z } from "zod";

// ---------- shared ----------
const Actor = z.enum(["agent", "you"]);

const Status = z
  .string()
  .describe(
    "One of: Backlog, Todo, In Progress, In Review, Done, Canceled (case-insensitive; also accepts backlog|todo|in_progress|in_review|done|canceled)."
  );

const Priority = z
  .union([z.number().int().min(0).max(4), z.enum(["none", "urgent", "high", "medium", "low"])])
  .describe("0/none, 1/urgent, 2/high, 3/medium, 4/low (same as Linear).");

const IssueRef = z.string().describe("Issue identifier like ABC-123 (or internal id).");
const ProjectRef = z.string().describe("Project key (e.g. ABC), name, or id.");

const Pagination = {
  limit: z.number().int().min(1).max(250).default(50).optional(),
  cursor: z.string().optional().describe("From a previous response's nextCursor."),
};
```

Result conventions: every tool returns text content containing compact JSON, and the same object as `structuredContent`. List tools return `{ items: [...], nextCursor }`. Errors: `isError: true` with a plain-language, actionable message.

## A.1 Projects

### `list_projects`
List projects.
```ts
{
  query: z.string().optional().describe("Match against name/key."),
  status: z.enum(["active", "paused", "completed", "canceled"]).optional(),
  includeDeleted: z.boolean().optional().describe("Include soft-deleted projects (flagged deleted:true)."),
  ...Pagination,
}
```
Returns: `{ items: [{ id, key, name, status, issueCounts: {backlog,todo,in_progress,in_review,done,canceled}, deleted? }], nextCursor }`

### `get_project`
```ts
{ project: ProjectRef, includeMilestones: z.boolean().default(true).optional() }
```
Returns the full project including description (markdown) and milestones with progress.

### `save_project`
Create (no `id`) or update (with `id`).
```ts
{
  id: z.string().optional().describe("Omit to create."),
  name: z.string().min(1).optional().describe("Required on create."),
  key: z.string().regex(/^[A-Z][A-Z0-9]{1,7}$/).optional()
    .describe("Issue prefix. Omit to use the default (MAT). Cannot be changed after issues exist."),
  description: z.string().optional().describe("Markdown."),
  status: z.enum(["active", "paused", "completed", "canceled"]).optional(),
}
```

### `delete_project`
Soft-delete a project (hides its milestones and issues). Restorable.
```ts
{
  project: ProjectRef,
  purge: z.boolean().default(false).optional()
    .describe("Permanent removal. Only works on already-deleted projects, and only if purge is permitted for your token."),
}
```

## A.2 Milestones

### `list_milestones`
```ts
{
  project: ProjectRef.optional(),
  includeDeleted: z.boolean().optional(),
  ...Pagination,
}
```
Returns: `{ items: [{ id, project, name, targetDate, progress: {done, total}, deleted? }], nextCursor }`

### `save_milestone`
```ts
{
  id: z.string().optional().describe("Omit to create."),
  project: ProjectRef.optional().describe("Required on create."),
  name: z.string().min(1).optional().describe("Required on create."),
  description: z.string().optional().describe("Markdown."),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().describe("YYYY-MM-DD; null clears."),
}
```

### `delete_milestone`
Issues in it are kept and their milestone is cleared.
```ts
{ id: z.string(), purge: z.boolean().default(false).optional() }
```

## A.3 Issues

### `list_issues`
```ts
{
  query: z.string().optional().describe("Full-text search over titles, descriptions, comments."),
  project: ProjectRef.optional(),
  status: z.union([Status, z.array(Status)]).optional(),
  assignee: z.enum(["agent", "you", "none"]).optional(),
  label: z.union([z.string(), z.array(z.string())]).optional().describe("Label name(s); issues must have all."),
  milestone: z.string().optional().describe("Milestone name or id."),
  parentId: IssueRef.optional().describe("List sub-issues of this issue."),
  priority: Priority.optional(),
  createdBy: Actor.optional(),
  updatedAfter: z.string().optional().describe("ISO 8601 timestamp or duration like -P1D."),
  includeDeleted: z.boolean().optional(),
  orderBy: z.enum(["updatedAt", "createdAt", "priority", "sortOrder"]).default("updatedAt").optional(),
  ...Pagination,
}
```
Returns compact items: `{ identifier, title, status, priority, assignee, labels, project, milestone, parent, estimate, updatedAt, descriptionSnippet, deleted? }`.

### `get_issue`
```ts
{
  id: IssueRef,
  include: z.array(z.enum(["comments", "attachments", "activity", "children", "relations"]))
    .default(["comments", "attachments", "children", "relations"]).optional(),
}
```
Returns the full issue including markdown description. `relations` = `{ blockedBy: [...], blocks: [...] }`.

### `save_issue`
Create (no `id`) or update (with `id`). Only the fields provided are changed.
```ts
{
  id: IssueRef.optional().describe("Omit to create."),
  title: z.string().min(1).optional().describe("Required on create."),
  project: ProjectRef.optional().describe("Required on create. On update, moves the issue (identifier unchanged)."),
  description: z.string().optional().describe("Markdown. Replaces the whole description."),
  status: Status.optional().describe("Default on create: Backlog."),
  priority: Priority.optional(),
  estimate: z.number().int().min(0).nullable().optional(),
  assignee: z.enum(["agent", "you"]).nullable().optional().describe("null unassigns."),
  labels: z.array(z.string()).optional()
    .describe("Replaces the label set. Names must already exist (see list_issue_labels)."),
  milestone: z.string().nullable().optional().describe("Milestone name or id in the issue's project; null clears."),
  parentId: IssueRef.nullable().optional().describe("Makes this a sub-issue; null detaches. Same project only."),
  blockedBy: z.array(IssueRef).optional().describe("Replaces the set of issues blocking this one."),
  blocks: z.array(IssueRef).optional().describe("Replaces the set of issues this one blocks."),
  expectedUpdatedAt: z.string().optional()
    .describe("Optimistic concurrency: fail if the issue changed since this timestamp."),
}
```

### `delete_issue`
Soft-delete an issue and its sub-issues, comments, and attachments. Restorable.
```ts
{ id: IssueRef, purge: z.boolean().default(false).optional() }
```

## A.4 Comments

### `list_comments`
```ts
{ issueId: IssueRef, includeDeleted: z.boolean().optional(), ...Pagination }
```
Returns: `{ items: [{ id, body, actor, parentId, createdAt, updatedAt, attachments, deleted? }], nextCursor }`

### `save_comment`
Create (no `id`) or edit (with `id`; actors may edit only their own comments).
```ts
{
  id: z.string().optional().describe("Omit to create."),
  issueId: IssueRef.optional().describe("Required on create."),
  body: z.string().min(1).describe("Markdown."),
  parentId: z.string().optional().describe("Reply to a comment (one level of threading)."),
}
```

### `delete_comment`
```ts
{ id: z.string(), purge: z.boolean().default(false).optional() }
```

## A.5 Labels

### `list_issue_labels`
```ts
{ project: ProjectRef.optional().describe("Include this project's labels plus global ones."), ...Pagination }
```

### `save_issue_label`
```ts
{
  id: z.string().optional().describe("Omit to create."),
  name: z.string().min(1).optional().describe("Required on create."),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  project: ProjectRef.nullable().optional().describe("Omit/null = global label."),
}
```
(Deleting labels is dashboard-only in v1; agents should not remove shared taxonomy.)

## A.6 Attachments

### `create_attachment`
Attach a file (typically a screenshot) to an issue or comment. Provide exactly one of `contentBase64` or `sourceUrl`.
```ts
{
  issueId: IssueRef,
  commentId: z.string().optional().describe("Attach to a specific comment instead of the issue."),
  filename: z.string().describe("e.g. login-bug.png"),
  mimeType: z.string().optional().describe("Inferred from content if omitted; verified by content sniffing."),
  contentBase64: z.string().optional().describe("Max ~5 MB decoded."),
  sourceUrl: z.string().url().optional().describe("HTTPS URL the server will download (size-capped)."),
}
```
Returns: `{ id, filename, mimeType, sizeBytes, url, markdown }` where `markdown` is a ready-to-paste snippet such as `![login-bug.png](<BASE_URL>/files/<id>)`.

### `get_attachment`
```ts
{ id: z.string(), includeContent: z.boolean().default(true).optional()
    .describe("For images under the size cap, return the image so you can view it.") }
```
Returns metadata, plus an MCP `image` content block for small images when `includeContent` is true.

### `delete_attachment`
```ts
{ id: z.string(), purge: z.boolean().default(false).optional() }
```

## A.7 Restore

### `restore`
Undo a soft delete. Restores the item and everything deleted with it in the same action.
```ts
{
  type: z.enum(["issue", "comment", "project", "milestone", "attachment", "memory", "document"]),
  id: z.string().describe("Identifier (ABC-123) for issues; id for others."),
}
```

## A.8 Tool summary

| Area | Tools |
|------|-------|
| Projects | `list_projects`, `get_project`, `save_project`, `delete_project` |
| Milestones | `list_milestones`, `save_milestone`, `delete_milestone` |
| Issues | `list_issues`, `get_issue`, `save_issue`, `delete_issue` |
| Comments | `list_comments`, `save_comment`, `delete_comment` |
| Labels | `list_issue_labels`, `save_issue_label` |
| Attachments | `create_attachment`, `get_attachment`, `delete_attachment` |
| Memory | `list_memories`, `get_memory`, `save_memory`, `delete_memory` |
| Documents | `list_documents`, `get_document`, `create_document`, `update_document`, `delete_document` |
| Restore | `restore` |

Total: 30 tools. Differences from Linear's MCP: no teams/users/cycles tools; explicit delete and restore tools; attachments uploadable by content or URL; a per-project knowledge layer (memories + documents) Linear has no equivalent for; actor model is `agent` / `you`.

---

# Appendix B: Notes for the implementing agent

- Read sections 3, 6, 9, and Appendix A before writing code. Business rules live only in `service/`.
- Start with migrations and service tests; adapters (REST, MCP) come after the service layer is green.
- Use transactions for every multi-row write (issue + labels + relations + activity + search index).
- Never log tokens or attachment contents. Log request id, actor, tool/route, duration.
- Keep tool descriptions short; they are paid for in every agent's context.
- Do not build the dashboard UI before the design phase (12.4) is approved; a minimal throwaway page for API smoke-testing is fine.
- When something in this spec conflicts with the current MCP SDK, Hono, Drizzle, or Next.js docs, follow the docs and record the deviation in `docs/decisions.md`.
