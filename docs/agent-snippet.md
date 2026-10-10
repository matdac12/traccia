# Traccia agent snippet

Paste everything below the line into the `AGENTS.md` (or `CLAUDE.md`) of any repo whose agents should use Traccia. It is not for this repo's own `AGENTS.md`, which configures agents working on the Traccia codebase. The tool names refer to the MCP tools in [mcp-tools.md](mcp-tools.md); connect first with [agent-setup.md](agent-setup.md).

---

## Issue tracker: Traccia

Issues for this project live in Traccia, reached through the `traccia` MCP server. Your writes are recorded as the `agent` actor.

- **Review the project's knowledge before starting work.** Call `list_memories` for the project (filter with `tags`, or search with `query`) and read the relevant ones with `get_memory`; call `list_documents` and `get_document` for files that bear on the task. Memories hold durable facts and lessons other agents recorded; do not re-learn them.
- **Record what the next agent should know.** Save a durable fact or lesson with `save_memory` (a short title, a markdown body, a few tags). Update an existing memory instead of adding a near-duplicate, and delete one that has gone stale. Use `create_document` for a file (markdown, text, JSON, PDF or an image) and paste the `markdown` it returns into an issue. Memories are project-scoped and are not linked to issues.
- **Search before you create.** Call `list_issues` (use `query`, and filter by `project`) before `save_issue`, so you do not file a duplicate. If a matching issue exists, comment on it instead.
- **Reference issues by identifier** (`TRC-123`) in commit messages, pull request titles and comments.
- **Keep the status honest.** Set `In Progress` when you start, `In Review` when a pull request or diff is ready, and `Done` only once the work is verified (tests pass, behaviour checked). Use `Canceled` only when asked.
- **Comment with progress and decisions, not noise.** Record what you chose and why, what is blocked, and what you verified. Do not narrate every step.
- **Attach a screenshot for UI bugs.** Use `create_attachment` and paste the returned `markdown` into the issue or comment.
- **Use labels that already exist.** Check `list_issue_labels` first and never invent a new label.
- **Never delete unless asked.** Deletes are soft and restorable with `restore`. Do not try to purge issues, comments, projects or milestones; agents cannot, by default. The exception is memories and documents: you may purge a stale memory or document, but only after soft-deleting it.
- **Hand over when you need a person.** When you need human input or a decision, comment with the question and assign the issue to `you`.
