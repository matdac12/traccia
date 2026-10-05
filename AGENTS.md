## Agent skills

### Issue tracker

Issues live in Traccia (project `Traccia`, key `TRC`), accessed via the `traccia` MCP. Linear (`MAT-nnn`) is a read-only archive. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Agent setup

Connect to the Traccia MCP and see the tool reference in `docs/agent-setup.md` and `docs/mcp-tools.md`.

### Checks

`pnpm check` runs lint + typecheck + tests. There is no CI: versioned git hooks (`.githooks/`, wired by `pnpm install`) lint staged files on commit and run `pnpm check` on push.
