# To-dos are not Issues, and get no MCP tools

The owner's Personal Space needed somewhere to put "things I intend to do". The obvious path was to reuse Issues inside a hidden personal Project, since Issues already have parents, positions, soft delete and both transports. We decided instead that a **To-do** is its own entity, with its own table, service and `/v1/todos` routes, and that it is reachable over **REST only**, never MCP.

Issues are work units mostly run by agents: they have a six-status workflow, assignees, priority, estimates, labels, blockers and an activity log. A To-do is coarser and personal ("work on client A UI today"). It has three states (open, done, dropped), one Planned day, at most one Reminder, Project references written as `@KEY`, and nothing else. Putting To-dos in a hidden Project would drag the whole Issue model and its MCP surface into every personal item, and would make "which Project is personal?" a rule every list, count and agent prompt has to remember. The Personal Space sits *above* Projects, so it can't sensibly be one.

No MCP tools, because agents work inside Projects and the Personal Space is the owner's. The MCP catalogue already has about 30 tools, and every new one costs context in every agent session. The only non-dashboard writer, the Parla dictation app, needs a single endpoint, so it uses REST with a Token limited by the new `todos` scope (the reserved `tokens.scopes` column), which can't reach anything else.

## Considered options

- **Issues in a hidden personal Project.** Rejected: the workflow, fields and agent visibility are all wrong for personal items, and "is this Project personal?" would leak into every query.
- **To-dos with MCP tools as well.** Rejected: no agent use case, and it adds context weight to every session. Easy to add later on the same service layer (ADR 0006) if one appears.

## Consequences

- To-dos repeat some machinery: Position (the same algorithm as Issues), a new Trash type, and their own schemas in `packages/shared`.
- Agents can't see or create To-dos. A future "agent asks the owner to do something" flow would need a new decision.
- Spec: `docs/personal-space.md`. Decisions: TRC-143, TRC-146 and TRC-149 (map TRC-142).
