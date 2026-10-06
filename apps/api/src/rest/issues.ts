import {
  createIssueInputSchema,
  deleteQuerySchema,
  getIssueQuerySchema,
  issuePositionBodySchema,
  listIssueGroupsQuerySchema,
  listIssuesQuerySchema,
  patchIssueBodySchema,
} from "@traccia/shared";
import type { Hono } from "hono";
import { type Issue, listIssueLabels, type Tx } from "../service/index.js";
import { setBlockersTx, setRelatedTx } from "../service/relations.js";
import type { AppContainer, AppEnv } from "./env.js";
import { servicesFor } from "./services.js";
import { ifMatch, validateBody, validateQuery } from "./validate.js";

/**
 * Issue routes. Issue responses carry `labels`. `GET /issues/:identifier`
 * returns the bare issue (plus `labels`) by default: the `comments`,
 * `activity`, `attachments`, `children` and `relations` keys are present only
 * when named in `?include=` (comma-separated), and nothing else is added.
 */
export function mountIssueRoutes(v1: Hono<AppEnv>, container: AppContainer) {
  const { issues, trash } = servicesFor(container);
  const { db } = container;
  const withLabels = <T extends Issue>(issue: T) => ({
    ...issue,
    labels: listIssueLabels(db, issue.id),
  });

  v1.get("/issues", (c) => {
    const page = issues.list(validateQuery(c, listIssuesQuerySchema));
    return c.json({ ...page, items: page.items.map(withLabels) });
  });

  // Registered before `/issues/:identifier`, which would otherwise take "groups" as an identifier.
  v1.get("/issues/groups", (c) => {
    const result = issues.listGroups(
      validateQuery(c, listIssueGroupsQuerySchema),
    );
    return c.json({
      ...result,
      groups: result.groups.map((g) => ({
        ...g,
        items: g.items.map(withLabels),
      })),
    });
  });

  v1.post("/issues", async (c) => {
    const body = await validateBody(c, createIssueInputSchema);
    return c.json(withLabels(issues.create(c.get("actor"), body)), 201);
  });

  v1.get("/issues/:identifier", (c) => {
    const { include } = validateQuery(c, getIssueQuerySchema);
    const detail = issues.get(c.req.param("identifier"), include ?? []);
    const { comments, activity, attachments, children, relations, ...issue } =
      detail;
    const out: Record<string, unknown> = withLabels(issue as Issue);
    if (include?.includes("comments")) out.comments = comments;
    if (include?.includes("activity")) out.activity = activity;
    if (include?.includes("attachments")) out.attachments = attachments;
    if (include?.includes("children")) out.children = children.map(withLabels);
    if (include?.includes("relations")) out.relations = relations;
    return c.json(out);
  });

  v1.patch("/issues/:identifier", async (c) => {
    const { blockedBy, blocks, related, ...fields } = await validateBody(
      c,
      patchIssueBodySchema,
    );
    // The body field wins over the header when both are present.
    fields.expectedUpdatedAt ??= ifMatch(c);
    const actor = c.get("actor");
    // Blocker and related changes run inside the update transaction: all or nothing.
    const hook =
      blockedBy !== undefined || blocks !== undefined || related !== undefined
        ? (tx: Tx, issue: Issue) => {
            let changed = false;
            if (blockedBy !== undefined || blocks !== undefined) {
              changed =
                setBlockersTx(tx, actor, issue.id, { blockedBy, blocks }) ||
                changed;
            }
            if (related !== undefined) {
              changed = setRelatedTx(tx, actor, issue.id, related) || changed;
            }
            return changed;
          }
        : undefined;
    const updated = issues.update(
      actor,
      c.req.param("identifier"),
      fields,
      hook,
    );
    return c.json(withLabels(updated));
  });

  v1.patch("/issues/:identifier/position", async (c) => {
    const body = await validateBody(c, issuePositionBodySchema);
    const moved = issues.move(c.get("actor"), {
      ...body,
      expectedUpdatedAt: body.expectedUpdatedAt ?? ifMatch(c),
      identifier: c.req.param("identifier"),
    });
    return c.json(withLabels(moved));
  });

  v1.delete("/issues/:identifier", async (c) => {
    const { purge } = validateQuery(c, deleteQuerySchema);
    const result = await trash.delete(
      c.get("actor"),
      "issue",
      c.req.param("identifier"),
      { purge },
    );
    if ("failedFiles" in result) {
      for (const storageKey of result.failedFiles) {
        c.get("logger").error("purged attachment file not removed", {
          issue: c.req.param("identifier"),
          storageKey,
        });
      }
    }
    return c.json({ ...result, purged: purge === true });
  });

  v1.post("/issues/:identifier/restore", (c) =>
    c.json(trash.restore(c.get("actor"), "issue", c.req.param("identifier"))),
  );
}
