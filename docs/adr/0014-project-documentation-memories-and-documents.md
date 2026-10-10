# Project documentation: memories and documents, a per-project knowledge layer

Traccia v1 listed *documents* as a non-goal (spec §1, §A.8). This reverses that: agents need one machine-independent place to record durable facts and hand off files, at the project level. A project gains a **Documentation** surface with two entities:

- **Memory** — a titled markdown note plus free-form tags, recording a fact or lesson. Edited in place; no version history.
- **Document** — a file with a name, MIME type and optional description, in the project's **Files**.

Both are project-scoped (never global), writable by both actors, and follow the standard soft-delete/restore model. They are **decoupled from issues**: a memory does not reference an issue, and an issue points at a document only by pasting its URL (the snippet `create_document` returns), with no backlinks. Files reuse the existing storage interface, content-addressed `sha256`, the 8-MIME allowlist and the 10 MiB cap; document name/description and memory title/body join the FTS index (no PDF text extraction).

Rejected: reusing issue **Attachments** for the drive (they are issue-scoped and the wrong shape); one `Knowledge` entity carrying an optional body and files (muddies the common text case); a workspace-global scope (deferred — project-only until further notice).

Consequence: files download only on the tailnet host. MCP returns text inline (memory bodies; `text/markdown`, `text/plain`, `application/json` documents), so an agent on the public `/mcp` connector gets all text but cannot fetch a binary — acceptable because text is the main case and PDFs are for the human in the browser.
