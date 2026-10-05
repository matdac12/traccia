import {
  type Actor,
  type CreateProjectInput,
  createProjectInputSchema,
  type ListProjectsInput,
  listProjectsInputSchema,
  ServiceError,
  type UpdateProjectInput,
  updateProjectInputSchema,
} from "@linear-matti/shared";
import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import { projects } from "../db/schema.js";
import { newId } from "../ids.js";
import { nowIso } from "../time.js";
import { type DbHandle, parseInput, type ServiceContext } from "./context.js";
import { ensureIssueKey } from "./issue-keys.js";

export type Project = typeof projects.$inferSelect;

/**
 * Resolves a project reference to exactly one project.
 *
 * All projects normally share one key (`MAT`), so a key alone is usually
 * ambiguous. Rules, in order (first step with any match decides):
 *   1. exact id;
 *   2. exact name (case-sensitive);
 *   3. exact key (case-sensitive) - only if exactly one project has it.
 * More than one match at the deciding step is a `conflict` listing the
 * candidate ids; no match at all is `not_found`. Soft-deleted projects are
 * ignored unless `includeDeleted` is set.
 */
export function resolveProject(
  db: DbHandle,
  ref: string,
  options: { includeDeleted?: boolean } = {},
): Project {
  const live = options.includeDeleted ? undefined : isNull(projects.deletedAt);
  const find = (condition: SQL) =>
    db
      .select()
      .from(projects)
      .where(and(condition, live))
      .orderBy(asc(projects.id))
      .all();

  const byId = find(eq(projects.id, ref));
  if (byId[0]) return byId[0];

  for (const [field, matches] of [
    ["name", find(eq(projects.name, ref))],
    ["key", find(eq(projects.key, ref))],
  ] as const) {
    if (matches.length === 1 && matches[0]) return matches[0];
    if (matches.length > 1) {
      throw new ServiceError(
        "conflict",
        `Project reference "${ref}" is ambiguous: ${matches.length} projects have that ${field}. Use the project id.`,
        { candidates: matches.map((p) => ({ id: p.id, name: p.name })) },
      );
    }
  }
  throw new ServiceError("not_found", `Project "${ref}" not found`);
}

export function createProjectsService(ctx: ServiceContext) {
  return {
    create(actor: Actor, input: CreateProjectInput): Project {
      const data = parseInput(createProjectInputSchema, input);
      const key = data.key ?? ctx.defaultIssueKey;
      return ctx.write((tx) => {
        ensureIssueKey(tx, key);
        const now = nowIso();
        return tx
          .insert(projects)
          .values({
            id: newId(),
            key,
            name: data.name,
            description: data.description ?? "",
            status: data.status ?? "active",
            createdBy: actor,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
      });
    },

    /** Look up by id, name or key; see `resolveProject` for the rules. */
    get(ref: string, options: { includeDeleted?: boolean } = {}): Project {
      return resolveProject(ctx.db, ref, options);
    },

    update(ref: string, input: UpdateProjectInput): Project {
      const patch = parseInput(updateProjectInputSchema, input);
      if (Object.values(patch).every((v) => v === undefined)) {
        throw new ServiceError("validation_error", "No fields to update");
      }
      return ctx.write((tx) => {
        const project = resolveProject(tx, ref);
        return tx
          .update(projects)
          .set({ ...definedOnly(patch), updatedAt: nowIso() })
          .where(eq(projects.id, project.id))
          .returning()
          .get();
      });
    },

    /** Oldest first. Soft-deleted projects are excluded unless `includeDeleted`. */
    list(input: ListProjectsInput = {}): Project[] {
      const filter = parseInput(listProjectsInputSchema, input);
      return ctx.db
        .select()
        .from(projects)
        .where(
          and(
            filter.includeDeleted ? undefined : isNull(projects.deletedAt),
            filter.status ? eq(projects.status, filter.status) : undefined,
          ),
        )
        .orderBy(asc(projects.id))
        .all();
    },
  };
}

export type ProjectsService = ReturnType<typeof createProjectsService>;

/** Drops `undefined` values so a partial patch never overwrites columns. */
export function definedOnly<T extends Record<string, unknown>>(
  patch: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
