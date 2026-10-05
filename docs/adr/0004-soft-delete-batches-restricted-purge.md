# Soft delete by default, restored by batch, purge restricted

Deleting sets `deleted_at` and a shared `deleted_batch` on the item and its dependents in one transaction, so one restore undoes the whole action. Purge is a separate second step, allowed only on already-deleted items, and `agent` tokens cannot purge unless `ALLOW_AGENT_PURGE=true`. This exists so an agent mistake is always recoverable. Deleting a milestone keeps its issues and only clears their `milestone_id`.

Delete and restore also bump `updated_at` on the rows they touch, so `updatedAfter` change probes (the dashboard's live refresh) see them.
