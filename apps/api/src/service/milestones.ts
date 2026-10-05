import {
  type Actor,
  type CreateMilestoneInput,
  createMilestoneInputSchema,
  ServiceError,
  type UpdateMilestoneInput,
  updateMilestoneInputSchema,
} from "@linear-matti/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { milestones, projects } from "../db/schema.js";
import { newId } from "../ids.js";
import { nowIso } from "../time.js";
import {
  type DbHandle,
  definedOnly,
  parseInput,
  type ServiceContext,
} from "./context.js";
import { resolveProject } from "./projects.js";

export type Milestone = typeof milestones.$inferSelect;

function getMilestone(db: DbHandle, id: string): Milestone {
  const row = db
    .select()
    .from(milestones)
    .where(and(eq(milestones.id, id), isNull(milestones.deletedAt)))
    .get();
  // A milestone of a soft-deleted project is treated as deleted too.
  const project = row
    ? db.select().from(projects).where(eq(projects.id, row.projectId)).get()
    : undefined;
  if (!row || project?.deletedAt) {
    throw new ServiceError("not_found", `Milestone "${id}" not found`);
  }
  return row;
}

export function createMilestonesService(ctx: ServiceContext) {
  return {
    /** `projectRef` is anything `resolveProject` accepts. */
    create(
      actor: Actor,
      projectRef: string,
      input: CreateMilestoneInput,
    ): Milestone {
      const data = parseInput(createMilestoneInputSchema, input);
      return ctx.write((tx) => {
        const project = resolveProject(tx, projectRef);
        const now = nowIso();
        return tx
          .insert(milestones)
          .values({
            id: newId(),
            projectId: project.id,
            name: data.name,
            description: data.description ?? "",
            targetDate: data.targetDate ?? null,
            sortOrder: data.sortOrder ?? 0,
            createdBy: actor,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
      });
    },

    get(id: string): Milestone {
      return getMilestone(ctx.db, id);
    },

    update(id: string, input: UpdateMilestoneInput): Milestone {
      const { expectedUpdatedAt, ...patch } = parseInput(
        updateMilestoneInputSchema,
        input,
      );
      if (Object.values(patch).every((v) => v === undefined)) {
        throw new ServiceError("validation_error", "No fields to update");
      }
      return ctx.write((tx) => {
        const milestone = getMilestone(tx, id);
        if (expectedUpdatedAt && expectedUpdatedAt !== milestone.updatedAt) {
          throw new ServiceError(
            "conflict",
            "Milestone was modified since it was read",
            { currentUpdatedAt: milestone.updatedAt },
          );
        }
        return tx
          .update(milestones)
          .set({ ...definedOnly(patch), updatedAt: nowIso() })
          .where(eq(milestones.id, milestone.id))
          .returning()
          .get();
      });
    },

    /** Milestones of one project by `sort_order`, then creation order. */
    list(
      projectRef: string,
      options: { includeDeleted?: boolean } = {},
    ): Milestone[] {
      const project = resolveProject(ctx.db, projectRef, options);
      return ctx.db
        .select()
        .from(milestones)
        .where(
          and(
            eq(milestones.projectId, project.id),
            options.includeDeleted ? undefined : isNull(milestones.deletedAt),
          ),
        )
        .orderBy(asc(milestones.sortOrder), asc(milestones.id))
        .all();
    },
  };
}

export type MilestonesService = ReturnType<typeof createMilestonesService>;
