#!/usr/bin/env tsx
/**
 * One-off: turn the legacy `Related (Linear): ...` lines the import appended to
 * descriptions into real symmetric "related" relations (TRC-94).
 *
 * Dry-run by default: it parses and reports, and writes nothing. Pass `--apply`
 * to create the relations and strip the converted lines from the descriptions.
 * Idempotent: re-running after `--apply` finds nothing to do.
 *
 * Run it against a copy of the database first. Usage:
 *
 *   pnpm --filter api exec tsx scripts/convert-linear-related.ts --data-dir "$DATA_DIR"
 *   pnpm --filter api exec tsx scripts/convert-linear-related.ts --db ./data/traccia.db --apply
 *
 * A line that names an issue that does not exist (or is deleted) is reported and
 * left in place, so its text is never silently lost.
 */
import Database from "better-sqlite3";
import { isNull } from "drizzle-orm";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  applyPragmas,
  createDb,
  type Db,
  openDatabase,
} from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { issues } from "../src/db/schema.js";
import { resolveIssue } from "../src/service/issues.js";
import { createServices } from "../src/service/index.js";
import { loadRelations } from "../src/service/relations.js";

export const RELATED_PREFIX = "Related (Linear):";

const RELATED_LINE = /^\s*Related \(Linear\):\s*(.*)$/i;
// Identifiers look like `TRC-12` (issue key, dash, number). `\b` keeps a match
// from starting inside a longer word.
const IDENTIFIER = /\b[A-Z][A-Z0-9]{1,7}-\d+\b/g;
// The import wrote `TRC-12 (was MAT-34)`; the legacy note must not be read as a
// second link.
const LEGACY_NOTE = /\(was\s+[A-Z0-9-]+\)/gi;

/** The identifiers named in a description's `Related (Linear):` lines, deduped, plus the text with those lines removed. */
export function parseRelatedDescription(description: string): {
  identifiers: string[];
  stripped: string;
} {
  const kept: string[] = [];
  const identifiers: string[] = [];
  for (const line of description.split("\n")) {
    const match = RELATED_LINE.exec(line);
    if (match) {
      const links = (match[1] ?? "").replace(LEGACY_NOTE, "");
      identifiers.push(...(links.toUpperCase().match(IDENTIFIER) ?? []));
    } else {
      kept.push(line);
    }
  }
  return {
    identifiers: [...new Set(identifiers)],
    stripped: kept.join("\n").trimEnd(),
  };
}

export type LinkOutcome = "created" | "already" | "missing" | "self";
export type LinkReport = { source: string; target: string; outcome: LinkOutcome };
export type ConversionReport = {
  scanned: number;
  candidates: number;
  links: LinkReport[];
  stripped: string[];
  applied: boolean;
};

/**
 * Creates the relations named by the legacy lines on every live issue. `apply`
 * false only computes the report (no writes). Relations are created through the
 * service, so they get the same activity rows and reindexing as a normal write.
 */
export function convertLinearRelated(
  db: Db,
  { apply }: { apply: boolean },
): ConversionReport {
  const services = createServices({ db, defaultIssueKey: "TRC" });
  const rows = db.select().from(issues).where(isNull(issues.deletedAt)).all();
  const report: ConversionReport = {
    scanned: rows.length,
    candidates: 0,
    links: [],
    stripped: [],
    applied: apply,
  };
  for (const source of rows) {
    if (!source.description.includes(RELATED_PREFIX)) continue;
    report.candidates++;
    const { identifiers, stripped } = parseRelatedDescription(source.description);
    if (identifiers.length === 0) continue;
    const current = new Set(
      loadRelations(db, source.id).related.map((r) => r.identifier.toUpperCase()),
    );
    let allResolved = true;
    for (const identifier of identifiers) {
      if (identifier === source.identifier) {
        report.links.push({ source: source.identifier, target: identifier, outcome: "self" });
        allResolved = false;
        continue;
      }
      let target: { identifier: string };
      try {
        target = resolveIssue(db, identifier);
      } catch {
        report.links.push({ source: source.identifier, target: identifier, outcome: "missing" });
        allResolved = false;
        continue;
      }
      const already = current.has(identifier);
      if (apply && !already) {
        services.relations.addRelated("agent", source.identifier, identifier);
      }
      report.links.push({
        source: source.identifier,
        target: target.identifier,
        outcome: already ? "already" : "created",
      });
      current.add(identifier);
    }
    // Keep the line when any id could not be turned into a relation, so its
    // text is not lost.
    if (apply && allResolved && stripped !== source.description) {
      services.issues.update("agent", source.identifier, { description: stripped });
      report.stripped.push(source.identifier);
    }
  }
  return report;
}

/** Prints the report as a few human lines. */
export function formatReport(report: ConversionReport): string {
  const count = (outcome: LinkOutcome) =>
    report.links.filter((l) => l.outcome === outcome).length;
  const lines = [
    `Scanned ${report.scanned} live issues; ${report.candidates} carry a "${RELATED_PREFIX}" line.`,
    `Links: ${count("created")} created, ${count("already")} already present, ${count("missing")} missing, ${count("self")} self.`,
  ];
  for (const link of report.links) {
    if (link.outcome === "missing" || link.outcome === "self") {
      lines.push(`  ${link.outcome}: ${link.source} -> ${link.target}`);
    }
  }
  if (report.applied) {
    lines.push(`Stripped the line from ${report.stripped.length} description(s).`);
  } else {
    lines.push("Dry run: nothing written. Re-run with --apply to create the relations and strip the lines.");
  }
  return lines.join("\n");
}

function main(argv: string[]): number {
  let values: { apply?: boolean; db?: string; "data-dir"?: string };
  try {
    values = parseArgs({
      args: argv,
      options: {
        apply: { type: "boolean", default: false },
        db: { type: "string" },
        "data-dir": { type: "string" },
      },
    }).values;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  const dataDir = values["data-dir"] ?? process.env.DATA_DIR ?? "/data";
  const sqlite = values.db
    ? (() => {
        const s = new Database(values.db as string);
        applyPragmas(s);
        return s;
      })()
    : openDatabase(dataDir).sqlite;
  try {
    const db = createDb(sqlite);
    runMigrations(db);
    const report = convertLinearRelated(db, { apply: values.apply === true });
    console.log(formatReport(report));
    return 0;
  } finally {
    sqlite.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
