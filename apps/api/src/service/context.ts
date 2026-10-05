import { ServiceError } from "@linear-matti/shared";
import type { z } from "zod";
import type { Db } from "../db/connection.js";

/**
 * Service container pattern
 * -------------------------
 * Business rules live only in `src/service/`; REST and MCP are thin adapters.
 * Each domain area is a factory `createXService(ctx)` that closes over a
 * `ServiceContext` and returns a plain object of functions. `createServices`
 * (index.ts) builds every service from one context, and the transports hold
 * that container. To add a service (issues, labels, ...):
 *
 *   1. write `createXService(ctx: ServiceContext)` in its own file;
 *   2. register it in `createServices`;
 *   3. do writes through `ctx.write(tx => ...)` and throw `ServiceError` for
 *      expected failures (never return error values, never throw bare Errors).
 *
 * Services that need another service's logic call its exported helpers with
 * the open transaction (e.g. `allocateIssueNumber(tx, key)`), so both writes
 * commit or roll back together.
 *
 * Every write that creates a row takes an `actor` and stamps `created_by`.
 */

/** The drizzle handle inside `db.transaction(...)`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Either the root database or an open transaction; reads work with both. */
export type DbHandle = Db | Tx;

export type ServiceContext = {
  db: Db;
  /** Value of `DEFAULT_ISSUE_KEY`, used when a project is created without a key. */
  defaultIssueKey: string;
  /**
   * Runs `fn` in a write transaction and returns its result; throwing rolls
   * back. The transaction is IMMEDIATE (takes the write lock up front) so a
   * read-then-write sequence can never hit SQLITE_BUSY on lock upgrade when
   * several connections write concurrently.
   */
  write<T>(fn: (tx: Tx) => T): T;
};

export function createServiceContext(options: {
  db: Db;
  defaultIssueKey: string;
}): ServiceContext {
  const { db, defaultIssueKey } = options;
  return {
    db,
    defaultIssueKey,
    write: (fn) => db.transaction(fn, { behavior: "immediate" }),
  };
}

/** Parses `input` with a shared Zod schema; failures become `validation_error`. */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const message = result.error.issues
    .map((i) =>
      i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message,
    )
    .join("; ");
  throw new ServiceError("validation_error", message, result.error.issues);
}
