# Agents may purge memories and documents

ADR 0004 restricts permanent purge to `you`, so an agent mistake is always recoverable. Memories are a deliberately pruned store — the intent is to keep only what is useful — and an agent must be able to remove a stale or wrong entry without waiting for a human.

So memories and documents keep the same soft-delete, trash and restore behaviour as everything else, but the purge exemption (`ALLOW_AGENT_PURGE`) applies to these two types by default: an `agent` token may permanently delete its own project's memories and documents. Issues, comments, projects, milestones and attachments are unchanged.

Consequence: an agent can make an unrecoverable mistake on a memory or document. Accepted because memories are cheap text and documents can be re-uploaded. Narrow and easy to revert: drop the exemption if drift ever becomes a problem.
