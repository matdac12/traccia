# Traccia

A minimal self-hosted issue tracker for one human and their AI agents, replacing a mostly unused Linear plan. Agents reach it over MCP; the human uses a dashboard.

## Language

**Traccia**:
The system this repo builds (Italian for "trace" or "track").
_Avoid_: Tracker, Linear clone, linear-matti

**Linear**:
The legacy SaaS Traccia replaces. Its workspace still hosts the build backlog until cutover.

**Pilot**:
The 1-2 week trial of Traccia on one new project before importing from Linear and cutting over.

### Actors

**Actor**:
Who performed a write. Exactly two exist: `agent` and `you`. Every token maps to one actor, and every write is attributed to it.
_Avoid_: user, author, member

**`you`**:
The actor for the human owner, including the dashboard's own token.
_Avoid_: user, human, Mattia (in code and docs)

**`agent`**:
The single actor shared by all AI agents. Named agents are a later extension.
_Avoid_: bot, assistant

**Assignee**:
The actor an issue is assigned to, or none. Uses the same two values as actor.

**Token**:
A revocable bearer credential tied to one actor, stored hashed and shown once at creation.
_Avoid_: API key, PAT

### Work items

**Project**:
A container of issues, milestones and project-scoped labels. Its status is `active`, `paused`, `completed` or `canceled`.

**Milestone**:
A named, optionally dated checkpoint inside one project. An issue's milestone must belong to the issue's project.

**Issue**:
A unit of work with a title, markdown description, status, priority, estimate, assignee and labels.
_Avoid_: ticket, task (in code and docs)

**Status**:
An issue's fixed workflow state: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `canceled`. Statuses are not customizable.
_Avoid_: state, column

**Priority**:
An issue's urgency from 0 to 4: none, urgent, high, medium, low (same numbering as Linear).

**Estimate**:
A non-negative integer of points on an issue, or none.

**Sub-issue**:
An issue with a parent issue in the same project. Nesting goes at most three levels deep.
_Avoid_: child task, subtask

**Blocker**:
An issue that must finish before another can proceed. "A blocks B" is a directed relation, and it may cross projects.
_Avoid_: dependency

**Label**:
A named, coloured tag that is either global or scoped to one project. Names are unique within their scope, ignoring case.

**Comment**:
A markdown note on an issue, with at most one level of replies.

**Attachment**:
A file (such as a screenshot) on an issue, optionally tied to one comment.

**Position**:
An issue's place in the order within its status column. Set by moving the issue between neighbours.
_Avoid_: rank, order index

### Identity

**Issue key**:
The uppercase prefix shared by issue identifiers (`MAT`), together with a counter that only increases. All projects share the key `MAT`.
_Avoid_: prefix, team key

**Issue number**:
An issue's sequence number under its issue key. Never reused, even after deletion or purge.

**Identifier**:
An issue's human-facing name: the issue key, a dash and the issue number (`MAT-123`). It never changes, even when the issue moves to another project.
_Avoid_: ID, ticket number

**ID**:
The internal ULID of any row. Distinct from the identifier.

### History and deletion

**Activity row**:
One entry on an issue's timeline recording who changed what. A save that changes several fields writes one activity row per field.
_Avoid_: audit log, event, history entry

**Delete**:
Always the soft kind: the item is hidden and can be restored. Deleting a parent hides its dependents under one shared batch.
_Avoid_: archive, remove

**Deleted**:
The state of a soft-deleted item. Lists hide deleted items unless asked.
_Avoid_: trashed, archived

**Restore**:
Undoing a delete for the whole batch it belonged to.
_Avoid_: undelete, recover

**Purge**:
Permanently removing an already deleted item, including its attachment files. Allowed for `you` only unless agent purge is switched on.
_Avoid_: hard delete, destroy

**Trash**:
The dashboard view listing deleted items, where `you` can restore or purge them.

### Access

**Tailnet**:
The private Tailscale network. Traccia is reachable only from devices on it.

**Dashboard**:
The web interface for `you`: a table grouped by status and a Kanban board. It reaches the data only through the API.
