# Issue tracker: Traccia

Issues and specs for this repo live in Traccia (this project's own tracker, self-hosted on a private tailnet), not in the repo and not on GitHub. Use the `traccia` MCP tools (`mcp__traccia__*`, see `docs/mcp-tools.md`); connect with `docs/agent-setup.md`. Writes are recorded as the `agent` actor.

- Server: `https://<your-tailnet-host>` (MCP at `/mcp`, tailnet only). The real URL lives in your local MCP configuration, not in the repo.
- Project: `Traccia`, key `TRC`. File every issue in it.

## Conventions

- **Search before you create**: `list_issues` with `query` and `project: TRC`; comment on an existing issue instead of filing a duplicate.
- **Create an issue**: `save_issue` with `project: TRC`, a title and a markdown description (real newlines, no escaped `\n`).
- **Read an issue**: `get_issue` by identifier (e.g. `TRC-123`); comments are included.
- **List/search issues**: `list_issues`, filtered by project, label or status.
- **Comment**: `save_comment`.
- **Apply / remove labels**: `save_issue` with the full desired label set; labels must already exist (`list_issue_labels`; see `docs/agents/triage-labels.md`).
- **Status**: `In Progress` when you start, `In Review` when a PR is ready, `Done` only once verified, `Canceled` for `wontfix`.
- Reference issues by identifier (`TRC-123`) in commits, PR titles and comments.

## Linear archive

Until the cutover this project's issues lived in Linear (identifiers `MAT-nnn`). All 91 were imported once into `TRC`; each imported description starts with `Migrated from Linear MAT-nnn`, and `MAT-nnn` mentions in text read `TRC-m (was MAT-nnn)`. Linear is now a **read-only archive**: do not create or edit issues there. To look up an old identifier, search Traccia for `MAT-nnn`.

## When a skill says "publish to the issue tracker"

Create a Traccia issue in project `TRC`.

## When a skill says "fetch the relevant ticket"

Call `get_issue` with the identifier.
