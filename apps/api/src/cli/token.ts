import { parseArgs } from "node:util";
import { ACTORS, type Actor } from "@traccia/shared";
import type { Db } from "../db/connection.js";
import { createToken, listTokens, revokeToken } from "../service/tokens.js";

/** Thrown for bad usage; the CLI prints the message and exits non-zero. */
export class UsageError extends Error {
  override name = "UsageError";
}

const TOKEN_USAGE = `Usage:
  traccia token create --name <name> --actor agent|you
  traccia token list
  traccia token revoke <id>

Run "traccia token <command> --help" for details.`;

const HELP = {
  create: `Usage: traccia token create --name <name> --actor agent|you

Creates a token and prints its plaintext once. It cannot be shown again.`,
  list: `Usage: traccia token list

Lists tokens: id, name, actor, created, last used, revoked. Never prints secrets.`,
  revoke: `Usage: traccia token revoke <id>

Revokes a token immediately. Revoking an already revoked token is a no-op.`,
};

function parse(args: string[]) {
  try {
    return parseArgs({
      args,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        name: { type: "string" },
        actor: { type: "string" },
      },
    });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
}

const cell = (value: string | null) => value ?? "-";

function table(header: string[], rows: string[][]): string {
  const all = [header, ...rows];
  const widths = header.map((_, i) =>
    Math.max(...all.map((r) => (r[i] ?? "").length)),
  );
  return all
    .map((r) =>
      r
        .map((c, i) => c.padEnd(widths[i] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

/** Help text for `traccia token ...` args, or null if help wasn't requested. */
export function tokenHelp(args: string[]): string | null {
  const [command] = args;
  if (command === "--help") return TOKEN_USAGE;
  if (!args.includes("--help") && !args.includes("-h")) return null;
  return command === "create" || command === "list" || command === "revoke"
    ? HELP[command]
    : TOKEN_USAGE;
}

export function runTokenCommand(
  db: Db,
  args: string[],
  out: (message: string) => void,
): void {
  const [command, ...rest] = args;
  if (command !== "create" && command !== "list" && command !== "revoke") {
    throw new UsageError(
      command
        ? `Unknown token command: ${command}\n${TOKEN_USAGE}`
        : TOKEN_USAGE,
    );
  }
  const { values, positionals } = parse(rest);
  if (
    command !== "create" &&
    (values.name !== undefined || values.actor !== undefined)
  ) {
    throw new UsageError(`traccia token ${command} takes no --name or --actor`);
  }

  if (command === "create") {
    if (positionals.length)
      throw new UsageError(`Unexpected argument: ${positionals[0]}`);
    if (!values.name?.trim()) throw new UsageError("--name is required");
    const actor = values.actor;
    if (!actor || !(ACTORS as readonly string[]).includes(actor)) {
      throw new UsageError("--actor must be one of: agent, you");
    }
    const created = createToken(db, {
      name: values.name,
      actor: actor as Actor,
    });
    out(
      `Created token ${created.id} (${created.name}, actor ${created.actor}).\n\n` +
        `${created.token}\n\n` +
        "Copy it now: this is the only time it is shown and it cannot be recovered.",
    );
  } else if (command === "list") {
    if (positionals.length)
      throw new UsageError(`Unexpected argument: ${positionals[0]}`);
    const rows = listTokens(db);
    if (!rows.length) return out("No tokens.");
    out(
      table(
        ["ID", "NAME", "ACTOR", "CREATED", "LAST USED", "REVOKED"],
        rows.map((t) => [
          t.id,
          t.name,
          t.actor,
          t.createdAt,
          cell(t.lastUsedAt),
          cell(t.revokedAt),
        ]),
      ),
    );
  } else {
    if (positionals.length !== 1)
      throw new UsageError("revoke takes exactly one <id>");
    const id = positionals[0] as string;
    const before = listTokens(db).find((t) => t.id === id);
    const token = revokeToken(db, id);
    out(
      before?.revokedAt
        ? `Token ${id} was already revoked at ${token.revokedAt}.`
        : `Revoked token ${id} (${token.name}).`,
    );
  }
}
