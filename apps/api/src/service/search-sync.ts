import { sql } from "drizzle-orm";
import type { Tx } from "./context.js";

/**
 * Seam between soft delete / purge (trash.ts) and the FTS5 `search_index`
 * (ADR 0005). Rows are keyed by `ref_id` (the row's ULID).
 *
 * - `removeFromSearchIndex` is real: delete and purge both just drop rows.
 * - `restoreToSearchIndex` is a STUB owned by MAT-1702: it receives the ids
 *   a restore brought back and must re-add their index rows (reading the
 *   current title/body from the base tables, inside the same transaction).
 */

export type RestoredRows = {
  projectIds: string[];
  milestoneIds: string[];
  issueIds: string[];
  commentIds: string[];
};

export function removeFromSearchIndex(tx: Tx, refIds: string[]): void {
  if (refIds.length === 0) return;
  // FTS5 `ref_id` is UNINDEXED, so this is a scan; fine at personal-tracker scale.
  tx.run(
    sql`DELETE FROM search_index WHERE ref_id IN (${sql.join(
      refIds.map((id) => sql`${id}`),
      sql`, `,
    )})`,
  );
}

/** TODO(MAT-1702): re-add index rows for restored rows. Intentionally a no-op here. */
export function restoreToSearchIndex(_tx: Tx, _restored: RestoredRows): void {}
