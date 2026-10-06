import { z } from "zod";
import { ISSUE_STATUSES } from "./enums.js";
import {
  listIssuesInputSchema,
  moveIssuePositionInputSchema,
} from "./issue-list-schemas.js";
import { ISSUE_INCLUDES, updateIssueInputSchema } from "./schemas.js";

// Query/body schemas for the issue REST routes (TRC-32). Query strings
// arrive as text, so numbers and booleans are coerced here; everything else
// reuses the service-layer schemas.

const boolText = z.enum(["true", "false"]).transform((v) => v === "true");
const limitText = z.coerce.number().int().min(1);

/** `GET /v1/issues`: the service list filters, with numbers/booleans as text. */
export const listIssuesQuerySchema = listIssuesInputSchema.extend({
  includeDeleted: boolText.optional(),
  limit: limitText.optional(),
});

/**
 * `GET /v1/issues/groups`: the list filters (`status` picks the groups, default all six), with `limit` per
 * group and one `cursor=<status>:<cursor>` per group to continue (repeatable). Yields `cursors` by status.
 */
export const listIssueGroupsQuerySchema = listIssuesQuerySchema
  .omit({ cursor: true })
  .extend({
    cursor: z
      .preprocess(
        (v) => (v === undefined || Array.isArray(v) ? v : [v]),
        z.array(
          z
            .string()
            .regex(/^[a-z_]+:.+$/, "expected <status>:<cursor>")
            .transform((s) => {
              const i = s.indexOf(":");
              return [s.slice(0, i), s.slice(i + 1)] as const;
            })
            .refine(([status]) => (ISSUE_STATUSES as readonly string[]).includes(status), "unknown status"),
        ),
      )
      .optional(),
  })
  .transform(({ cursor, ...rest }) => ({
    ...rest,
    cursors: Object.fromEntries(cursor ?? []) as Partial<Record<(typeof ISSUE_STATUSES)[number], string>>,
  }));

/** `GET /v1/issues/:identifier?include=comments,activity,...` (comma-separated, repeatable). */
export const getIssueQuerySchema = z.object({
  include: z
    .preprocess(
      (v) =>
        (Array.isArray(v) ? v : v === undefined ? [] : [v]).flatMap((s) =>
          String(s)
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
        ),
      z.array(z.enum(ISSUE_INCLUDES)),
    )
    .optional(),
});

/**
 * `PATCH /v1/issues/:identifier`. `blockedBy` / `blocks` / `related` are issue
 * identifiers and REPLACE the whole set, like `labels`; omit a key to leave it
 * alone. `related` is symmetric: one stored pair, shown on both issues.
 */
export const patchIssueBodySchema = updateIssueInputSchema.extend({
  blockedBy: z.array(z.string().min(1)).optional(),
  blocks: z.array(z.string().min(1)).optional(),
  related: z.array(z.string().min(1)).optional(),
});
export type PatchIssueBody = z.input<typeof patchIssueBodySchema>;

/** `PATCH /v1/issues/:identifier/position`; the identifier comes from the path. */
export const issuePositionBodySchema = moveIssuePositionInputSchema.omit({
  identifier: true,
});

/** `DELETE ...?purge=true`. */
export const deleteQuerySchema = z.object({ purge: boolText.optional() });

/** `GET /v1/search?q=&project=&limit=&cursor=`. */
export const searchQuerySchema = z.object({
  q: z.string(),
  project: z.string().min(1).optional(),
  limit: limitText.optional(),
  cursor: z.string().min(1).optional(),
});

/** `GET /v1/activity?project=&limit=&cursor=`. */
export const activityQuerySchema = z.object({
  project: z.string().min(1).optional(),
  limit: limitText.optional(),
  cursor: z.string().min(1).optional(),
});

/** `GET /v1/trash?type=&limit=&cursor=`. */
export const trashQuerySchema = z.object({
  type: z
    .enum(["project", "milestone", "issue", "comment", "attachment"])
    .optional(),
  limit: limitText.optional(),
  cursor: z.string().min(1).optional(),
});
