import { issueKeySchema } from "@linear-matti/shared";
import { eq, sql } from "drizzle-orm";
import { issueKeys } from "../db/schema.js";
import { parseInput, type Tx } from "./context.js";

/**
 * Creates the key row on first use (spec 6.2); a no-op if it exists.
 * Validates the format so callers get a `validation_error` rather than the
 * raw CHECK failure (the CHECK remains as the backstop).
 */
export function ensureIssueKey(tx: Tx, key: string): void {
  parseInput(issueKeySchema, key);
  tx.insert(issueKeys).values({ key }).onConflictDoNothing().run();
}

/**
 * Reserves the next issue number for `key` and returns it.
 *
 * Must run inside a write transaction (`ctx.write`): the single atomic
 * `UPDATE ... RETURNING` is what makes concurrent allocation unique, and being
 * in the caller's transaction means a rolled-back issue insert rolls the
 * counter back too. A committed number is never reused: deleting or purging
 * issues does not decrement the counter. Creates the key row if needed.
 */
export function allocateIssueNumber(tx: Tx, key: string): number {
  ensureIssueKey(tx, key);
  const row = tx
    .update(issueKeys)
    .set({ nextNumber: sql`${issueKeys.nextNumber} + 1` })
    .where(eq(issueKeys.key, key))
    .returning({ number: sql<number>`${issueKeys.nextNumber} - 1` })
    .get();
  // The row was just ensured inside this transaction, so it must exist.
  if (!row) throw new Error(`issue key ${key} vanished during allocation`);
  return row.number;
}
