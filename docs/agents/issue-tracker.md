# Issue tracker: Linear

Issues and specs for this repo live in Linear, not in the repo and not on GitHub. Use the Linear MCP tools (`mcp__claude_ai_Linear__*`); there is no CLI.

- Workspace: `matdac6` (https://linear.app/matdac6)
- Team: `Matdac6`, key `MAT`
- Project: `MATTI-TRACKER` (https://linear.app/matdac6/project/matti-tracker-3b06cfad4445). Attach every issue you create to this project.

## Conventions

- **Create an issue**: `save_issue` with team `Matdac6`, project `MATTI-TRACKER`, a title, and a markdown description (real newlines, no escaped `\n`).
- **Read an issue**: `get_issue` by identifier (e.g. `MAT-123`); `list_comments` for the discussion.
- **List/search issues**: `list_issues`, filtered by project, label or status.
- **Comment**: `save_comment`.
- **Apply / remove labels**: `save_issue` with the full desired label set; create missing labels with `create_issue_label` (see `docs/agents/triage-labels.md`).
- **Close**: `save_issue` with a Done status, or Canceled for `wontfix`.

## When a skill says "publish to the issue tracker"

Create a Linear issue in `MATTI-TRACKER`.

## When a skill says "fetch the relevant ticket"

Call `get_issue` with the identifier, plus `list_comments`.
