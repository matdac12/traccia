import {
  listIssueLabelsToolShape,
  ServiceError,
  saveIssueLabelToolShape,
} from "@traccia/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Label } from "../../service/labels.js";
import type { McpContext } from "../server.js";
import { defineTool, paginate, resolveProjectRef } from "./helpers.js";
import { compactObject } from "./present.js";
import { mcpServices } from "./services.js";

export function registerLabelTools(server: McpServer, ctx: McpContext) {
  const { projects, labels } = mcpServices(ctx);
  const view = (l: Label) =>
    compactObject({
      id: l.id,
      name: l.name,
      color: l.color,
      project: l.projectId
        ? projects.get(l.projectId, { includeDeleted: true }).name
        : undefined,
    });

  defineTool(
    server,
    ctx,
    "list_issue_labels",
    "List global labels, plus a project's labels when project is given. There is no delete tool; labels are removed in the dashboard.",
    listIssueLabelsToolShape,
    (args) => {
      const rows = labels.list({
        project: args.project
          ? resolveProjectRef(projects, args.project).id
          : undefined,
      });
      const page = paginate(
        rows.map((l) => ({ id: l.id })),
        args,
      );
      const byId = new Map(rows.map((l) => [l.id, l]));
      return {
        ...page,
        items: page.items.map((i) => view(byId.get(i.id) as Label)),
      };
    },
  );

  defineTool(
    server,
    ctx,
    "save_issue_label",
    "Create a label (omit id; name required; no project = global) or update name/color (with id). Names are unique per scope, case-insensitive.",
    saveIssueLabelToolShape,
    (args) => {
      const { id, ...fields } = args;
      if (id === undefined) {
        if (!fields.name) {
          throw new ServiceError(
            "validation_error",
            "name is required to create a label",
          );
        }
        return view(
          labels.create({
            ...fields,
            name: fields.name,
            project: fields.project
              ? resolveProjectRef(projects, fields.project).id
              : null,
          }),
        );
      }
      if (fields.project !== undefined) {
        throw new ServiceError(
          "validation_error",
          "A label's project cannot change; omit project when updating.",
        );
      }
      const { project: _project, ...patch } = fields;
      return view(labels.update(id, patch));
    },
  );
}
