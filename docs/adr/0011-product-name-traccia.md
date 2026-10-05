# The product is named Traccia; code identifiers stay `tracker` until the launch rename

"Traccia" (Italian for "trace" or "track") replaces the working name "Tracker" in the glossary, README and spec title. Code, config and paths still say `tracker` (the `tracker` CLI, the MCP server name, `/opt/tracker`, `TRACKER_API_*` env vars, the `@traccia` package scope), so agents mid-build are not disrupted. Rename them in one pass before the pilot's agent configs are rolled out, or at cutover. Checked 2026-10-05: the npm name `traccia`, the GitHub user `traccia` and `traccia-ai/*` (AI agent observability, an adjacent audience) are taken, so use a scoped or prefixed package and a distinct GitHub org at launch.

Update: the code identifiers were renamed in [ADR 0012](0012-rename-to-traccia-with-legacy-aliases.md); the paragraph above describes the state when this was decided.
