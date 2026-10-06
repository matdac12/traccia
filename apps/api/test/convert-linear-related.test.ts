import { describe, expect, it } from "vitest";
import { createServices } from "../src/service/index.js";
import { loadRelations } from "../src/service/relations.js";
import { createTestDb } from "./helpers/test-db.js";
import {
  convertLinearRelated,
  parseRelatedDescription,
} from "../scripts/convert-linear-related.js";

function setup() {
  const { sqlite, db } = createTestDb();
  const services = createServices({ db, defaultIssueKey: "TRC" });
  const project = services.projects.create("you", { name: "Traccia", key: "TRC" });
  const mk = (title: string, description: string) =>
    services.issues.create("you", { project: project.id, title, description });
  return { sqlite, db, services, mk };
}

describe("parseRelatedDescription", () => {
  it("reads the identifiers and removes the whole line", () => {
    expect(
      parseRelatedDescription(
        "Body text\n\nRelated (Linear): TRC-1 (was MAT-1), TRC-2 (was MAT-2)",
      ),
    ).toEqual({ identifiers: ["TRC-1", "TRC-2"], stripped: "Body text" });
  });

  it("handles several lines, keeps other text and dedupes", () => {
    const description = [
      "First paragraph.",
      "Related (Linear): MAT-9 (was MAT-9)",
      "",
      "Last paragraph.",
      "Related (Linear): TRC-3 (was MAT-3), TRC-3 (was MAT-3)",
    ].join("\n");
    expect(parseRelatedDescription(description)).toEqual({
      identifiers: ["MAT-9", "TRC-3"],
      stripped: "First paragraph.\n\nLast paragraph.",
    });
  });

  it("leaves a description without the prefix alone", () => {
    expect(parseRelatedDescription("No links here.\nMAT-1")).toEqual({
      identifiers: [],
      stripped: "No links here.\nMAT-1",
    });
  });
});

describe("convertLinearRelated", () => {
  it("dry-run reports the links and writes nothing", () => {
    const { db, mk, services } = setup();
    const a = mk("A", "Body\n\nRelated (Linear): TRC-2 (was MAT-2)");
    mk("B", "");

    const report = convertLinearRelated(db, { apply: false });
    expect(report.candidates).toBe(1);
    expect(report.links).toEqual([
      { source: "TRC-1", target: "TRC-2", outcome: "created" },
    ]);
    expect(report.stripped).toEqual([]);
    expect(loadRelations(db, a.id).related).toEqual([]);
    expect(services.issues.get(a.id).description).toContain("Related (Linear)");
  });

  it("apply creates the symmetric relation, strips the line and is idempotent", () => {
    const { db, mk, services } = setup();
    const a = mk("A", "Body\n\nRelated (Linear): TRC-2 (was MAT-2)");
    const b = mk("B", "");

    const report = convertLinearRelated(db, { apply: true });
    expect(report.links).toEqual([
      { source: "TRC-1", target: "TRC-2", outcome: "created" },
    ]);
    expect(report.stripped).toEqual(["TRC-1"]);
    expect(loadRelations(db, a.id).related.map((r) => r.identifier)).toEqual([
      "TRC-2",
    ]);
    expect(loadRelations(db, b.id).related.map((r) => r.identifier)).toEqual([
      "TRC-1",
    ]);
    expect(services.issues.get(a.id).description).toBe("Body");

    const again = convertLinearRelated(db, { apply: true });
    expect(again.candidates).toBe(0);
    expect(again.links).toEqual([]);
  });

  it("keeps the line when an identifier cannot be resolved", () => {
    const { db, mk, services } = setup();
    const a = mk("A", "Related (Linear): TRC-99 (was MAT-99)");

    const report = convertLinearRelated(db, { apply: true });
    expect(report.links).toEqual([
      { source: "TRC-1", target: "TRC-99", outcome: "missing" },
    ]);
    expect(report.stripped).toEqual([]);
    expect(services.issues.get(a.id).description).toContain("TRC-99");
  });

  it("reports a self-link and keeps the line", () => {
    const { db, mk, services } = setup();
    const a = mk("A", "Related (Linear): TRC-1 (was MAT-1)");

    const report = convertLinearRelated(db, { apply: true });
    expect(report.links).toEqual([
      { source: "TRC-1", target: "TRC-1", outcome: "self" },
    ]);
    expect(report.stripped).toEqual([]);
    expect(services.issues.get(a.id).description).toContain("TRC-1");
  });

  it("reports an already-present link without creating it twice", () => {
    const { db, mk, services } = setup();
    const a = mk("A", "Related (Linear): TRC-2 (was MAT-2)");
    mk("B", "");
    services.relations.addRelated("you", a.identifier, "TRC-2");

    const report = convertLinearRelated(db, { apply: true });
    expect(report.links).toEqual([
      { source: "TRC-1", target: "TRC-2", outcome: "already" },
    ]);
    expect(report.stripped).toEqual(["TRC-1"]);
  });
});
